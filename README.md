# dsh-cron

中文 | [English](README.en.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）
插件，新增人机交互用的 `/cron` 斜杠命令，实现**按 cron 定时循环**。

`/cron "*/30 * * * *"` 启动时会先发一条确认通知，随后在每个匹配该 cron 表达
式的整分时刻（例如 `:00` 和 `:30`）触发一次，每次提醒 agent 继续工作，直到
你用 `/cron stop` 停止。

## 安装

### DeepSeek Harness 桌面版

在桌面版的**插件管理**里添加插件时，填 GitHub 规格（注意不是包名）：

```
github:XiaoWind/dsh-cron#<40 位 commit sha>
```

**请钉住完整 40 位 commit。** DSH 插件管理器只对来源固定到完整 commit 的 git
插件报告 `update: 'git'`，并允许它热更新；这也是本插件运行时自动更新的前提
（见下文「自动更新」）。不带 `#<sha>` 也能安装，但自动更新会保持关闭。

桌面版会在 profile 目录里执行 `pnpm add`，并用本包 `engines.dsh`
（`>=0.2.2-rc.5 <0.3.0`）校验当前 DSH 版本；不兼容时拒绝安装并回滚
`package.json`、`pnpm-lock.yaml` 和 `node_modules`。校验通过后把本包加入
`dsh.profile.bundles`。**安装后按提示重启桌面应用**才会生效。

> **必须使用 `github:owner/repo` 这种规格。** 本插件没有发布到 npm registry，
> 只写 `dsh-cron` 会去 npm 上查找，安装会失败。

### CLI / Web 版

```sh
# 从 GitHub 安装，并钉住完整 commit（自动更新的前提）
dsh plugin --profile web add "github:XiaoWind/dsh-cron#<40 位 commit sha>"

# 也可以只用默认分支安装（自动更新保持关闭）
dsh plugin --profile web add github:XiaoWind/dsh-cron
```

`dsh plugin` 会把参数转发给 `web` profile 目录内的 `pnpm`，随后自动把该包加入
`dsh.profile.bundles` 层级列表（因为本包声明了 `dsh.bundle.patch`）。安装后请
重启 Web 应用。

> 本插件注入 `commands` 服务，因此只在包含命令适配器的 profile 中生效——官方
> 自带的 `web` profile 就包含它。

## 自动更新

插件自带运行时自动更新，不需要外部脚本：

1. 启动约 90 秒后检查一次 GitHub 上 `XiaoWind/dsh-cron` 的最新 commit，之后每
   6 小时检查一次；
2. 读取该 commit 的 `package.json`，仅当 `version` 比运行中的版本新时才更新；
3. 通过 DSH 插件管理器把安装整体热更新到该 commit（固定到 40 位 sha 的 git
   规格）。桌面版 profile 启用 HMR，插件会被移除并以新版本重新加载，无需重启；
4. 成功或失败都会以会话通知的形式报告；失败不会改变正在运行的版本，下一轮检查
   会重试。

检查本身失败（网络、HTTP 或读不到 `package.json`）时，15 分钟后重试；安装失败则等
下一个检查周期，并会发一条通知说明原因。

**前提**：本插件必须以固定 40 位 commit 的规格安装（见「安装」）。未固定的安装
不会自动更新；`/cron update` 会提示重新安装的方式。

可在 profile 的 `cordis.patch.yml` 中调整：

```yaml
- id: cron
  config:
    autoUpdate: true                 # false 关闭自动检查
    updateCheckIntervalMs: 21600000  # 两次检查间隔（默认 6 小时）
    updateInitialDelayMs: 90000      # 启动后首次检查延迟（默认 90 秒）
```

设置环境变量 `DSH_PLUGIN_AUTO_UPDATE=0` 可全局关闭自动更新。检查走
`api.github.com`（contents API），失败时回退到 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net`；若遇到未认证请求限流，可在环境
中设置 `GITHUB_TOKEN`。手动触发一次检查：`/cron update`。

### 手动更新（不使用自动更新时）

**桌面版**：在插件管理里移除本插件，再按固定 commit 的规格重新添加；更新后重启
桌面应用。

**CLI / Web 版**：

```sh
dsh plugin --profile web update dsh-cron
# 或显式钉到新 commit
dsh plugin --profile web add "github:XiaoWind/dsh-cron#<新 commit sha>"
```

更新后请重启应用——bundle 层在启动时组合，运行中的进程不会热更已安装的插件。

## 用法

| 命令 | 作用 |
|---|---|
| `/cron "*/30 * * * *"` | 每小时在 :00 和 :30 触发；保留已有目标。 |
| `/cron "0 9 * * 1-5"` | 工作日 09:00 触发。 |
| `/cron "0 9 * * 1-5" 修好测试` | 工作日 09:00 围绕目标触发。 |
| `/cron 修好测试` | 围绕目标触发，使用默认计划。 |
| `/cron resume` | 恢复重启前保存的计划。 |
| `/cron` 或 `/cron status` | 查看当前计划。 |
| `/cron stop` | 停止计划。 |
| `/cron update` | 立即检查一次插件更新。 |
| `/cron help` | 查看帮助。 |

计划为标准 **5 段 cron**（分钟 小时 日 月 星期），分钟精度，按**本地时间**计
算。字段支持 `*`、`*/n`、`n`、`a-b`、`a-b/n`、`a,b,c` 及月份/星期名称
（`JAN`..`DEC`、`SUN`..`SAT`，不区分大小写）。不支持秒字段。

开头的 5 段 cron 是计划，其余部分是目标；没有开头 cron 时，整个输入即目标，并
使用默认计划。

### 语义

- **按墙钟对齐。** 任务的首次触发发生在下一个匹配 cron 表达式的整分时刻；启动
  `/cron` 时会先发一条确认通知（开启一个回合），让新会话立即出现在会话列表中。
- **绝不打断进行中的回合。** 若触发时刻 agent 正忙，会等它回到空闲后再触发（补
  上这一次，不丢失）。
- **跨重启保存。** 计划持久化到 `$DSH_HOME/dsh-cron/<sessionId>.json`。重启后
  重新打开该会话时，插件会自动恢复计划并弹窗告知；需要时可用 `/cron resume`
  手动恢复，`/cron stop` 则丢弃已保存的计划。
- **手动停止。** 计划会一直运行，直到你执行 `/cron stop`、agent 被销毁或插件被
  卸载；没有自动完成检测。

## 配置

可通过 `config.defaultCron`（5 段 cron 字符串）修改「`/cron <目标>` 未给出计划」
时使用的默认计划，缺省为 `*/10 * * * *`（每 10 分钟）。

```yaml
# 你的 profile 的 cordis.patch.yml
- id: cron
  config:
    defaultCron: "0 * * * *"
```

## 开发

```sh
# 语法检查
node --check lib/index.js
node --check lib/cron.js
node --check lib/self-update.js
```

插件是单文件 ESM Cordis 函数插件（`lib/index.js`），无需构建步骤。它导出
`apply`、`inject`、`name`，并由 bundle 层 `cordis.patch.yml` 插入到 profile 组合中。

## License

MIT
