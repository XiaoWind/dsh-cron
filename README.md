# dsh-cron

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
plugin that adds a human-facing `/cron` slash command for **cron-scheduled,
recurring agent loops**.

`/cron "*/30 * * * *"` fires one tick at every wall-clock minute matching the
cron expression (for example `:00` and `:30`), re-prompting the agent each
time, until you stop it with `/cron stop`.

## Install

```sh
# from GitHub (works immediately — no npm publish required)
dsh plugin --profile web add git+https://github.com/XiaoWind/dsh-cron.git

# or from npm, once published
dsh plugin --profile web add dsh-cron
```

The `dsh plugin` command forwards to `pnpm` inside the `web` profile directory,
then reconciles the profile's `dsh.profile.bundles` layer list. Because this
package declares `dsh.bundle.patch`, it joins the layer stack automatically.
Restart the Web app after installing.

> The plugin injects the `commands` service, so it activates only in profiles
> that compose a command adapter — the shipped `web` profile does.

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

- **Wall-clock anchored.** Unlike `/loop`, there is no immediate first tick —
  the first tick fires at the next wall-clock minute matching the cron
  expression.
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

# cron parser unit test
node test/cron.test.mjs
```

The plugin is a single-file ESM Cordis function plugin (`lib/index.js`) with no
build step. It exports `apply`, `inject`, and `name`, and the bundle layer
`cordis.patch.yml` inserts it into the profile composition.

## License

MIT
