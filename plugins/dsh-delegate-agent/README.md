# @weekit/dsh-delegate-agent

在 DSH Web 会话中把任务委派给本机安装的 Pi、Codex 或 Grok CLI。插件通过 DSH 的认证 RPC 接收 Web 操作，通过 `ctx.subprocess` 管理外部进程树，并把任务状态、输出、事件和结果持久化到 `${DSH_HOME:-~/.dsh}/delegate-agent/tasks.json`。

## 功能

- 从当前 DSH 会话绑定的 workspace 启动任务，浏览器不能伪造其他工作目录。
- Pi、Codex、Grok 的独立 argv 构造和 JSON/JSONL 协议解析。
- 实时任务列表、可切换原始/格式化 JSON 的 stdout 时间线、stderr、最终结果、协议事件和诊断信息。
- 工作区级具名委派预设，保存 Agent、权限、模型参数和固定提示词；执行时只需填写任务指令。
- 任务超时、手动取消、进程树回收、并发上限和输出字节上限。
- DSH 重启后把未完成任务标记为 `interrupted`，不会伪装为仍在运行。
- 任务按发起会话隔离；RPC 由 DSH Connection 的 Host/Origin 与浏览器认证机制保护。

## 安装

从仓库根目录构建并加入 Web profile：

```sh
pnpm install --frozen-lockfile
pnpm --filter @weekit/dsh-delegate-agent build
dsh plugin --profile web add ./plugins/dsh-delegate-agent
```

重启 DSH Web 后，会话视图中会出现“委派”标签。

## 配置

默认配置适合先以只读模式验证。插件依赖 Web profile 已提供 `connection`、`subprocess` 和 `workspaceRegistry` 服务。

```yaml
- name: '@weekit/dsh-delegate-agent'
  config:
    maxConcurrentRuns: 3
    defaultTimeoutMs: 1800000
    terminateGraceMs: 3000
    maxLogBytes: 2097152
    maxEventCount: 2000
    retentionDays: 30
    defaultPermissionMode: read-only
    allowedWorkspaceRoots:
      - ~/development
    adapters:
      pi:
        command: pi
        enabled: true
      codex:
        command: codex
        enabled: true
      grok:
        command: ~/.grok/bin/grok
        enabled: true
```

每个 adapter 还可配置显式 `env`。DSH subprocess 会清除环境中名称匹配 `KEY`、`PASSWORD`、`SECRET`、`TOKEN` 和 `DSH_*` 的隐式变量；只有 adapter `env` 中显式配置的值会重新传入。不要把密钥提交到 composition 文件。

## 权限语义

| 模式 | Pi | Codex | Grok |
| --- | --- | --- | --- |
| `read-only` | `--tools read,grep,find,ls --no-approve` | `--sandbox read-only` | `--permission-mode plan` |
| `workspace-write` | 默认工具 + `--no-approve` | `--sandbox workspace-write` | `--permission-mode acceptEdits` |

Pi CLI 没有等价于 Codex OS sandbox 的工作区边界。`workspace-write` 只表示不收窄 Pi 的工具集合，不能视为操作系统级隔离。需要强隔离时，继续使用只读模式或在外部容器/沙箱中运行 Pi。

## 数据与清理

任务保存到 `${DSH_HOME:-~/.dsh}/delegate-agent/tasks.json`，委派预设保存到同目录的 `presets.json`。目录权限为 `0700`，文件权限为 `0600`，写入采用临时文件加原子 rename。

默认保留已结束任务 30 天，插件启动以及运行期间的任务读写都会清理过期记录。Web 中的清理按钮只删除当前会话的已结束任务；`starting`、`running` 和 `stopping` 任务不会被删除。预设按 workspace 共享，不跨 workspace 可见，且每个 workspace 最多 50 个。

## 已验证兼容性

参数契约已在本机通过 help/version 非网络检查：Pi `0.85.1`、Codex `0.153.0`、Grok `1.0.13`。自动化测试使用 fake subprocess 和受控 JSONL，不调用已配置的模型 API，也不消耗模型配额。

真实认证调用仍受本机 CLI 配置、模型可用性和上游输出协议影响。解析器无法识别的行会保留在 stdout 并写入诊断，不会丢失原始可见输出。

## Skills 与上下文发现

当前 Web 手动委派不依赖额外 skill：用户已经在“委派”标签页明确选择 adapter、权限和任务指令，插件直接使用当前会话绑定的 workspace。

若后续希望主 Agent 自主判断并发起委派，则需要单独增加三层能力：Host 侧受控 delegation tool、描述委派时机与约束的 skill，以及动态上下文提供器（可用 adapter、当前 workspace、并发余量）。这不应只靠静态 prompt 注入实现；当前 DSH `connection.rpc` 也不提供服务端认证的 session identity，因此模型侧调用还需要独立的授权与归属校验。本版本不注册 model-facing tool 或配套 skill。

## 当前边界

- 当前版本提供 DSH Web 委派闭环，尚未注册模型可调用的 `delegate_start` tool。
- 外部 CLI session resume/fork 尚未开放；任务默认使用独立临时会话。
- 任务事件数据已保存，但当前 UI 先提供事件检查器，没有绘制 graph。
- 持久化使用单机原子 JSON 快照，适合个人 DSH Web 实例，不用于多进程共享写入。

## 开发

```sh
pnpm --filter @weekit/dsh-delegate-agent check
pnpm --filter @weekit/dsh-delegate-agent pack --dry-run
```
