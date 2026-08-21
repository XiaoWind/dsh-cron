# dsh-cron

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）
插件，新增人机交互用的 `/cron` 斜杠命令，实现**按 cron 定时循环**。

`/cron "*/30 * * * *"` 启动时会先发一条确认通知，随后在每个匹配该 cron 表达
式的整分时刻（例如 `:00` 和 `:30`）触发一次，每次提醒 agent 继续工作，直到
你用 `/cron stop` 停止。

## 安装

```sh
# 从 GitHub 安装（立即可用，无需发布到 npm）
dsh plugin --profile web add git+https://github.com/XiaoWind/dsh-cron.git

# 或发布到 npm 后
dsh plugin --profile web add dsh-cron
```

`dsh plugin` 会把参数转发给 `web` profile 目录内的 `pnpm`，随后自动把该包加入
`dsh.profile.bundles` 层级列表（因为本包声明了 `dsh.bundle.patch`）。安装后请
重启 Web 应用。

> 本插件注入 `commands` 服务，因此只在包含命令适配器的 profile 中生效——官方
> 自带的 `web` profile 就包含它。

## 更新

把已安装的插件更新到 GitHub 最新版：

```sh
dsh plugin --profile web update dsh-cron
```

`dsh plugin` 会把参数转发给 profile 目录里的 `pnpm update dsh-cron`，把
`github:XiaoWind/dsh-cron` 重新解析到默认分支的最新 commit。锁文件按 commit
钉住 git 依赖，因此不必升级 `version` 也能更新。若 pnpm 因缓存没有拉到新
commit，可显式重新钉一次：

```sh
dsh plugin --profile web add github:XiaoWind/dsh-cron
```

更新后请重启 Web 应用——bundle 层在启动时组合，运行中的 Web 进程不会热更已安装的插件。

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

# cron 解析单元测试
node test/cron.test.mjs
```

插件是单文件 ESM Cordis 函数插件（`lib/index.js`），无需构建步骤。它导出
`apply`、`inject`、`name`，并由 bundle 层 `cordis.patch.yml` 插入到 profile 组合中。

## License

MIT
