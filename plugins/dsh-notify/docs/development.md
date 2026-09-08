# 开发说明

## 已知限制

- 系统通知需要浏览器页面保持打开，并受浏览器与操作系统通知权限共同控制。
- 当前 DSH 没有公开的 session-row adornment slot；侧栏状态灯会在结构不匹配或存在同名会话时安全跳过，不会猜测目标会话。
- `document.title` 只能使用文本动画，因此运行中提示使用 Unicode spinner，而不是 CSS 圆环。

## 通知架构

插件以“顶层任务完全收敛后才产生结果通知”为统一语义。`turn/end` 只更新 pending candidate，不直接发布。普通 fork 虽有 `parentSession`／`parentId`，但没有 `origin: 'subagent'`，仍作为独立顶层任务处理。子代理的完成、错误、中止／中断、阻塞和 Token 限制均不产生独立结果通知。

Session Projection 的 `startedAsyncDelegation` 表示该轮结束时仍有未收敛异步委派，由 durable `tool/call`／`tool/result` 共同计算。识别范围包括：始终异步的 `de_coi_dispatch`；默认后台、但允许显式 `run_in_background: false` 的 `subagent`／`subagent_fork`；仅显式后台的 `bash`；`de_session` spawn；默认 `wait: false` 的 `run_workflow`；`create_goal`；`update_goal` resume/edit；以及 `functions.run_code` 中已知字面 `tools.bash`／`tools.subagent`／`tools.subagent_fork` 配合 `run_in_background: true`。run_code 只做保守字符串检查，不执行代码。同一轮通过 `job_output`、`de_coi_wait/status/cancel` 等明确收集到终态时会抵消对应未收敛项；无法证明终态时继续抑制，避免提前报完成。

浏览器通过 `sessions.list` 消费 `dshNotify`、`summary.running`、`jobsBySession` 和会话谱系。纯状态机分离 observed、pending、published 与 settling；新 turn 覆盖候选，Agent running 或 live job 会取消旧窗口。只有主会话 idle、该任务及连续 subagent 后代没有 running/stopping job、没有运行中的 subagent 后代、没有 active 自动 goal、候选轮未启动异步委派时，才在短收敛窗口后产生一个最终 `AttentionEntry`。系统 Notification、`document.title` 结果动画和侧栏状态灯只消费这个最终条目。

Host 的 `HostNotificationCoordinator` 注入 agents/jobs/sessions，并监听 `session/event`、`agent/status`、jobs changed、`agent/created`／`agent/disposed`。过滤和收敛都发生在 `DingTalkService.notify()` 之前；窗口结束后的异步标题解析也携带可取消信号，因此 job settle 后同步 followup 不会把中间轮写入钉钉持久队列。该路径不依赖 `dsh-memory-evolve`。

结果 attention 与运行状态相互独立。运行中的子代理仍通过 `parentId` 折叠到可见父会话，只影响 `document.title` 的 running spinner 和会话计数。可靠性边界仍位于 `DingTalkService`：最终消息在网络发送前写入 `$DSH_HOME/dsh-notify/dingtalk-missed.json`，失败或 Host 重启后重试；交付是 at-least-once，极端崩溃窗口可能重复。

## 本地开发

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
```

`pnpm run check` 会执行类型检查、测试、构建和发布脚本自检。`lib/` 是本地 build 生成的临时目录，不提交到 Git；发布 workflow 会在 CI 中构建它，并将其打入预构建 `.tgz`。

版本维护流程见 [版本与发布](releasing.md)。返回 [README](../README.md)。
