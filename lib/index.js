/**
 * dsh-cron — a human-facing `/cron` slash command that runs the agent on a
 * cron-scheduled, recurring loop.
 *
 * `/cron <cron>` fires at every wall-clock minute matching the cron
 * expression, re-prompting the agent each time, until the human stops it with
 * `/cron stop`.
 *
 * The schedule is standard 5-field cron (minute hour day-of-month month
 * day-of-week), minute resolution, evaluated in local time.
 *
 * Schedule config is persisted to `$DSH_HOME/dsh-cron/<sessionId>.json` so it
 * survives a restart. When a session with a saved schedule is opened again,
 * the plugin resumes it automatically and tells the user via a prompt (with a
 * notice fallback when no interactive prompt is available).
 *
 * @module dsh-cron
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { nextCronTime, parseCron } from "./cron.js";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Cordis function-plugin name, used in log labels. */
const name = "cron";

/** Services this plugin requires before it activates. */
const inject = ["commands", "agents", "userQuestions"];

/** Default schedule for `/cron <objective>` (no leading cron expression). */
const DEFAULT_CRON = "*/10 * * * *";

/** Directory under the DSH home holding one JSON file per saved schedule. */
const STATE_DIR = "dsh-cron";

/** Longest single setTimeout delay Node accepts (~24.8 days). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const USAGE =
  "Usage: /cron [<cron expr>] [<objective>] | /cron resume | /cron stop | /cron status";

const HELP = [
  "Runs the agent on a cron schedule: one tick at each matching wall-clock time.",
  "",
  "Examples:",
  "  /cron \"*/30 * * * *\"           every 30 minutes",
  "  /cron \"0 9 * * 1-5\"            weekdays at 09:00",
  "  /cron \"0 9 * * 1-5\" fix tests  weekdays at 09:00 toward an objective",
  "  /cron fix tests                 objective at the default schedule",
  "  /cron resume                    resume the schedule saved before a restart",
  "  /cron status                    show the running schedule",
  "  /cron stop                      stop the schedule",
  "",
  "The schedule is standard 5-field cron (minute hour day-of-month month",
  "day-of-week), minute resolution, local time. Supported per-field syntax:",
  "* , */n , n , a-b , a-b/n , and month/day names (JAN..DEC, SUN..SAT).",
].join("\n");

/** Normalize the `defaultCron` plugin config to a valid expression. */
function resolveDefaultCron(value) {
  if (typeof value === "string" && parseCron(value) !== null) return value;
  return DEFAULT_CRON;
}

/** Split input on whitespace and strip surrounding quotes from each token. */
function splitTokens(input) {
  return input
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""));
}

// ── persistence ────────────────────────────────────────────────────────────

function statePath(sessionId) {
  return dshHomePath(STATE_DIR, `${sessionId}.json`);
}

function readState(sessionId) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
    if (typeof parsed?.cronExpr === "string" && parseCron(parsed.cronExpr) !== null) {
      return {
        cronExpr: parsed.cronExpr,
        objective:
          typeof parsed.objective === "string" && parsed.objective !== ""
            ? parsed.objective
            : null,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeState(sessionId, state) {
  const path = statePath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state), "utf8");
}

function clearState(sessionId) {
  try {
    unlinkSync(statePath(sessionId));
  } catch {
    // Already absent.
  }
}

function isLive(ctx, agent) {
  try {
    return ctx.agents.get(agent.id) === agent && ctx.agents.roots().includes(agent);
  } catch {
    return false;
  }
}

function noticeMessage(text) {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "cron", form: "notice", summary: text },
  });
}

/**
 * One live agent's cron-loop state and timer. Installed on the agent's own
 * context so its timers are disposed with the agent; a plugin-level disposer
 * also stops every runtime on plugin teardown. Persistence is owned by the
 * command handlers, not the runtime, so disposal alone never discards a saved
 * schedule.
 */
class CronRuntime {
  constructor(agent) {
    this.agent = agent;
    this.cronExpr = null;
    this.cron = null;
    this.objective = null;
    this.ticks = 0;
    this.nextFireAt = null;
    this.running = false;
    this.stopped = false;
    this.timer = null;
  }

  /** Start (or restart) the cron loop. */
  start(cronExpr, objective) {
    this.cronExpr = cronExpr;
    this.cron = parseCron(cronExpr);
    if (objective !== undefined && objective !== "") this.objective = objective;
    this.running = true;
    this.stopped = false;
    this.arm();
  }

  /** Stop the loop and cancel its pending timer. */
  stop() {
    this.running = false;
    this.stopped = true;
    this.clearTimer();
  }

  clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Arm one timer segment for the next cron match. Node timers cannot exceed
   * ~24.8 days, so a far-future match re-checks the wall clock on each wake.
   */
  arm() {
    this.clearTimer();
    if (!this.running || this.stopped) return;
    const now = Date.now();
    const next = nextCronTime(this.cron, now);
    if (next === undefined) {
      this.stop();
      return;
    }
    this.nextFireAt = next;
    const delay = Math.min(next - now, MAX_TIMER_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drive();
    }, delay);
  }

  /** Fire one tick, waiting out a busy agent so a running turn is never cut. */
  async fire() {
    while (this.running && !this.stopped) {
      try {
        return await this.agent.runMaintenance(() => {
          if (!this.running || this.stopped) return Promise.resolve(false);
          this.ticks += 1;
          this.agent.followup(this.tickMessage());
          return Promise.resolve(true);
        });
      } catch {
        // Another turn or maintenance task owns the agent; wait for idle and
        // retry (catch-up the missed occurrence).
        await this.waitForIdle();
        if (!this.running || this.stopped) return false;
      }
    }
    return false;
  }

  /** Timer entry: fire if due, then arm the next match after now. */
  async drive() {
    if (!this.running || this.stopped) return;
    this.clearTimer();

    // A capped timer can wake before the true fire time; just re-arm.
    if (this.nextFireAt !== null && Date.now() < this.nextFireAt) {
      this.arm();
      return;
    }

    const queued = await this.fire();
    if (!this.running || this.stopped) return;
    if (queued) await this.waitForIdle();
    this.arm();
  }

  /** Await quiescence, contained so a failure never leaves a hung promise. */
  async waitForIdle() {
    if (!this.running) return;
    try {
      await this.agent.whenIdle();
    } catch {
      // Ignore idle-wait failures; the caller re-arms or stops by itself.
    }
  }

  /** Build the immutable follow-up message for one tick. */
  tickMessage() {
    const lines = [
      "[CRON TICK]",
      `Scheduled cron tick #${this.ticks} (schedule ${JSON.stringify(this.cronExpr)}).`,
    ];
    if (this.objective) {
      lines.push(`Objective: ${JSON.stringify(this.objective)}`);
      lines.push(
        "Continue working toward the objective above. Treat the workspace, tool " +
          "results, and durable session state as authoritative. Stop only when the " +
          "user runs /cron stop.",
      );
    } else {
      lines.push(
        "Continue working on your current task. Treat the workspace, tool results, " +
          "and durable session state as authoritative. The schedule repeats at each " +
          "cron match until the user runs /cron stop.",
      );
    }
    const text = lines.join("\n");
    return createUserMessage({
      content: [{ type: "text", text }],
      source: {
        kind: "plugin",
        plugin: "cron",
        form: "notice",
        summary: `Cron tick #${this.ticks}`,
      },
    });
  }

  /** Render the current schedule for `/cron` and `/cron status`. */
  status() {
    if (!this.running) {
      return { kind: "success", text: `No cron schedule is running.\n${USAGE}` };
    }
    const lines = [
      "Cron schedule is running.",
      `Schedule: ${this.cronExpr}`,
      `Ticks fired: ${this.ticks}`,
    ];
    if (this.objective) lines.push(`Objective: ${this.objective}`);
    if (this.nextFireAt !== null) {
      lines.push(`Next tick at: ${new Date(this.nextFireAt).toLocaleString()}`);
    }
    lines.push("", "Stop with /cron stop.");
    return { kind: "success", text: lines.join("\n") };
  }

  /** Confirmation text returned after `/cron` starts. */
  startedText() {
    const lines = ["Cron schedule started."];
    lines.push(`Schedule: ${this.cronExpr}`);
    if (this.objective) lines.push(`Objective: ${this.objective}`);
    if (this.nextFireAt !== null) {
      lines.push(`Next tick at: ${new Date(this.nextFireAt).toLocaleString()}`);
    }
    lines.push("", "Stop with /cron stop.");
    return lines.join("\n");
  }
}

/**
 * Execute one `/cron` invocation against the receiving agent.
 */
function executeCommand(ctx, invocation, state) {
  const input = (invocation.rawInput ?? "").trim();
  const lower = input.toLowerCase();
  const agent = invocation.agent;

  if (input.length === 0 || lower === "status") {
    return state.ensureRuntime(agent).status();
  }

  if (lower === "stop" || lower === "clear" || lower === "off") {
    return state.stopCron(agent);
  }

  if (lower === "resume") {
    return state.resumeCron(agent);
  }

  if (lower === "help") {
    return { kind: "success", text: HELP };
  }

  // A leading 5-field cron expression is the schedule; the rest is the
  // objective.
  const tokens = splitTokens(input);
  if (tokens.length >= 5) {
    const cronExpr = tokens.slice(0, 5).join(" ");
    if (parseCron(cronExpr) !== null) {
      const objective = tokens.slice(5).join(" ").trim();
      const runtime = state.startCron(agent, cronExpr, objective === "" ? undefined : objective);
      return { kind: "success", text: runtime.startedText() };
    }
  }

  // No leading cron: the whole input is the objective, using the default
  // schedule (config.defaultCron).
  const runtime = state.startCron(agent, state.defaultCron, input);
  return { kind: "success", text: runtime.startedText() };
}

/**
 * Resume a saved cron schedule automatically and tell the user it is running.
 * Runs without blocking the `agent/created` dispatch.
 */
function maybeResumeCron(ctx, agent, state) {
  const saved = readState(agent.id);
  if (saved === undefined) return;

  state.startCron(agent, saved.cronExpr, saved.objective ?? undefined);

  const summary = `Cron schedule resumed: ${saved.cronExpr}`;
  const notifyFallback = () => {
    try {
      agent.inject(noticeMessage(summary));
    } catch {
      // Agent already gone.
    }
  };
  try {
    ctx.userQuestions
      .ask({
        agent,
        questions: [
          {
            id: "resumed",
            header: "Cron",
            question: `Cron schedule resumed: ${saved.cronExpr}`,
            options: [{ label: "OK" }],
          },
        ],
      })
      .catch(notifyFallback);
  } catch {
    notifyFallback();
  }
}

/**
 * Cordis function plugin. Registers the `/cron` command, owns the per-agent
 * cron runtimes, and resumes saved schedules when a session is opened.
 */
function apply(ctx, config = {}) {
  const defaultCron = resolveDefaultCron(config.defaultCron);
  const runtimes = new Map();

  const ensureRuntime = (agent) => {
    const existing = runtimes.get(agent.id);
    if (existing !== undefined) return existing.runtime;
    const runtime = new CronRuntime(agent);
    const entry = { runtime, cleanup: null };
    entry.cleanup = agent.ctx.effect(() => () => {
      runtime.stop();
      if (runtimes.get(agent.id) === entry) runtimes.delete(agent.id);
    });
    runtimes.set(agent.id, entry);
    return runtime;
  };

  const startCron = (agent, cronExpr, objective) => {
    const runtime = ensureRuntime(agent);
    runtime.start(cronExpr, objective);
    writeState(agent.id, { cronExpr, objective: runtime.objective });
    return runtime;
  };

  const stopCron = (agent) => {
    const entry = runtimes.get(agent.id);
    const had = (entry !== undefined && entry.runtime.running) || readState(agent.id) !== undefined;
    clearState(agent.id);
    if (entry !== undefined) entry.runtime.stop();
    return { kind: "success", text: had ? "Cron schedule stopped." : "No cron schedule is running." };
  };

  const resumeCron = (agent) => {
    const saved = readState(agent.id);
    if (saved === undefined) {
      return { kind: "error", text: "No saved cron schedule to resume." };
    }
    const runtime = startCron(agent, saved.cronExpr, saved.objective ?? undefined);
    return { kind: "success", text: runtime.startedText() };
  };

  const state = { defaultCron, runtimes, ensureRuntime, startCron, stopCron, resumeCron };

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: "cron",
      description: "run the agent on a cron schedule (e.g. /cron \"*/30 * * * *\")",
      input: { hint: "[<cron expr>] [<objective>] | resume | stop | status" },
      handler: (invocation) => executeCommand(ctx, invocation, state),
    });
    const offCreated = ctx.on("agent/created", ({ agent }) => {
      try {
        if (!ctx.agents.roots().includes(agent)) return;
        maybeResumeCron(ctx, agent, state);
      } catch {
        // Never veto agent publication.
      }
    });
    return () => {
      offCreated();
      dispose();
      for (const { cleanup } of runtimes.values()) cleanup();
      runtimes.clear();
    };
  });
}

export { apply, inject, name };
