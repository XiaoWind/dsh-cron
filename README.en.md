# dsh-cron

[中文](README.md) | English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
plugin that adds a human-facing `/cron` slash command for **cron-scheduled,
recurring agent loops**.

`/cron "*/30 * * * *"` posts a start notice, then fires one tick at every
wall-clock minute matching the cron expression (for example `:00` and `:30`),
re-prompting the agent each time, until you stop it with `/cron stop`.

## Install

### DeepSeek Harness Desktop

Add the plugin in the desktop app's plugin manager using a GitHub spec — not the
package name:

```
github:XiaoWind/dsh-cron#<40-char commit sha>
```

**Pin the full 40-character commit.** DSH's plugin manager only reports
`update: 'git'` (and allows a hot update) for a git source pinned to a full
commit; that pin is also what the runtime auto-update below needs. A plain
`github:XiaoWind/dsh-cron` spec still installs, but auto-update stays off.

The desktop app runs `pnpm add` in its profile directory, checks this package's
`engines.dsh` (`>=0.2.2-rc.5 <0.3.0`) against the running DSH version, and adds
the package to `dsh.profile.bundles` once it passes. An incompatible plugin is
refused and `package.json`, `pnpm-lock.yaml`, and `node_modules` are rolled
back. **Restart the desktop app when prompted** for the plugin to take effect.

> **The `github:owner/repo` spec is required.** This plugin is not published to
> the npm registry, so a bare `dsh-cron` would be looked up on npm and the
> installation would fail.

### CLI / Web

```sh
# from GitHub, pinned to a full commit (required for auto-update)
dsh plugin --profile web add "github:XiaoWind/dsh-cron#<40-char commit sha>"

# or install from the default branch (auto-update stays off)
dsh plugin --profile web add github:XiaoWind/dsh-cron
```

The `dsh plugin` command forwards to `pnpm` inside the `web` profile directory,
then reconciles the profile's `dsh.profile.bundles` layer list. Because this
package declares `dsh.bundle.patch`, it joins the layer stack automatically.
Restart the Web app after installing.

> The plugin injects the `commands` service, so it activates only in profiles
> that compose a command adapter — the shipped `web` profile does.

## Auto-update

The plugin updates itself at runtime, no external script required:

1. About 90 seconds after start — then every 6 hours — it checks the latest
   commit on GitHub for `XiaoWind/dsh-cron`;
2. it reads that commit's `package.json` and only updates when `version` is
   newer than the running one;
3. it hot-updates the installed plugin to that commit through the DSH plugin
   manager (a git spec pinned to the 40-char sha). Profiles with HMR enabled —
   including the desktop app — remove and reload the plugin in place, no restart
   needed;
4. success or failure is reported as a session notice; a failure leaves the
   running version untouched and the next check retries.

A failed lookup (network error, HTTP error, or an unreadable `package.json`) is
retried after 15 minutes; a failed install waits for the next check and is
reported with a notice.

**Prerequisite**: the plugin must be installed with a full-commit spec (see
Install). A non-pinned install never auto-updates; `/cron update` tells you how
to reinstall.

Tune it in the profile's `cordis.patch.yml`:

```yaml
- id: cron
  config:
    autoUpdate: true                 # false disables the checks
    updateCheckIntervalMs: 21600000  # between checks (default 6 hours)
    updateInitialDelayMs: 90000      # first check (default 90 seconds)
```

Set `DSH_PLUGIN_AUTO_UPDATE=0` to disable auto-update for all plugins. Checks
try `api.github.com` (contents API) first, then fall back to `raw.githubusercontent.com` and `cdn.jsdelivr.net`; set `GITHUB_TOKEN` if you
hit unauthenticated rate limits. Trigger a check manually with `/cron update`.

### Manual update (when auto-update is off)

**Desktop**: remove the plugin in the plugin manager and add it again with a
pinned spec; restart the app afterwards.

**CLI / Web**:

```sh
dsh plugin --profile web update dsh-cron
# or pin a specific commit explicitly
dsh plugin --profile web add "github:XiaoWind/dsh-cron#<new commit sha>"
```

Restart the app after updating — the bundle layer is composed at boot, so a
running process does not hot-reload an installed plugin unless HMR is enabled.

## Usage

| Command | Result |
|---|---|
| `/cron "*/30 * * * *"` | Fire at :00 and :30 every hour. Keeps any current objective. |
| `/cron "0 9 * * 1-5"` | Fire weekdays at 09:00. |
| `/cron "0 9 * * 1-5" fix the tests` | Weekdays at 09:00 toward an objective. |
| `/cron fix the tests` | Fire toward an objective at the default schedule. |
| `/cron resume` | Resume the schedule saved before a restart. |
| `/cron` or `/cron status` | Show the running schedule. |
| `/cron stop` | Stop the schedule. |
| `/cron update` | Check for a plugin update now. |
| `/cron help` | Show help. |

The schedule is standard **5-field cron** (minute hour day-of-month month
day-of-week), minute resolution, evaluated in **local time**. Supported
per-field syntax: `*`, `*/n`, `n`, `a-b`, `a-b/n`, `a,b,c`, and month/day
names (`JAN`..`DEC`, `SUN`..`SAT`, case-insensitive). Seconds are not
supported.

A leading 5-field cron expression is the schedule and the remainder is the
objective; with no leading cron, the whole input is the objective and the
default schedule applies.

### Semantics

- **Wall-clock anchored.** The objective's first tick fires at the next
  wall-clock minute matching the cron expression. Starting `/cron` posts a
  confirmation notice first, so a fresh session opens a turn and appears in the
  session list immediately.
- **Never interrupts a running turn.** If a fire time arrives while the agent is
  busy, the tick waits for idle and then fires (it catches up the missed
  occurrence).
- **Saved across restarts.** The schedule is persisted to
  `$DSH_HOME/dsh-cron/<sessionId>.json`. When you reopen the session after a
  restart, the plugin resumes the schedule automatically and tells you it is
  running; `/cron resume` restarts it manually when needed, and `/cron stop`
  discards the saved schedule.
- **Manual stop.** The schedule runs until you run `/cron stop`, the agent is
  disposed, or the plugin is unloaded. There is no automatic completion
  detection.

## Configuration

Set `config.defaultCron` (a 5-field cron string) to change the schedule used by
a bare `/cron <objective>` with no leading cron expression. The default is
`*/10 * * * *` (every 10 minutes).

```yaml
# your profile's cordis.patch.yml
- id: cron
  config:
    defaultCron: "0 * * * *"
```

## Development

```sh
# syntax check
node --check lib/index.js
node --check lib/cron.js
node --check lib/self-update.js
```

The plugin is a single-file ESM Cordis function plugin (`lib/index.js`) with no
build step. It exports `apply`, `inject`, and `name`, and the bundle layer
`cordis.patch.yml` inserts it into the profile composition.

## License

MIT
