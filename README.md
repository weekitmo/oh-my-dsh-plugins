# oh-my-dsh-plugins

自用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合，使用 pnpm workspace 统一管理。

## 插件

| 插件 | 包名 | 功能 |
| --- | --- | --- |
| [通知](plugins/dsh-notify) | `@weekit/dsh-notify` | 桌面、浏览器标题和侧边栏任务完成通知 |
| [请求追踪](plugins/dsh-trace) | `@weekit/dsh-trace` | 检查脱敏后的 LLM HTTP 请求与响应 |
| [快捷键与终端](plugins/dsh-keybinding) | `@weekit/dsh-keybinding` | Web 快捷键管理和本地交互终端 |

## 安装

环境要求：已安装 DeepSeek Harness，且 `dsh` 和 `pnpm` 位于 `PATH`。安装器支持 `curl` 或 `wget`，并使用系统中的 `sha256sum`、`shasum` 或 `openssl` 校验下载内容。

### 一键安装全部插件

直接执行 GitHub 最新 Release 中的安装器。不指定插件时，默认安装全部三个插件到 `web` profile：

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh
```

使用 wget：

```sh
wget -qO- https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh
```

### 单独安装

通过 `sh -s --` 把 scoped 包名传给安装器：

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-notify
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-trace
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-keybinding
```

### 指定 Profile

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- all --profile my-profile
```

也可以组合单插件与 profile：

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-trace --profile my-profile
```

### 固定 Release 版本

固定版本时，安装器和插件产物应来自同一个 tag：

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/download/v0.1.1/install.sh | sh -s -- all --version v0.1.1
```

安装器从对应 GitHub Release 下载 `dsh-notify.tgz`、`dsh-trace.tgz` 和 `dsh-keybinding.tgz`，按 `SHA256SUMS` 校验后缓存到 `${DSH_HOME:-~/.dsh}/plugins-cache/oh-my-dsh-plugins/<tag>/`，再加入指定 DSH profile。可以通过 `DSH_PLUGIN_CACHE` 改变缓存根目录。

从旧独立仓库版本迁移时，如果 profile 中已经安装过未 scoped 的 `dsh-notify` 或 `dsh-trace`，先按实际存在的旧包执行：

```sh
dsh plugin --profile web remove dsh-notify
dsh plugin --profile web remove dsh-trace
```

然后再运行新的 Release 安装命令。新版本在 profile 中统一显示为 `@weekit/dsh-notify`、`@weekit/dsh-trace` 和 `@weekit/dsh-keybinding`。

### 从源码安装

开发 checkout 可以直接构建并安装本地目录：

```sh
pnpm install --frozen-lockfile
pnpm --filter @weekit/dsh-trace build
dsh plugin --profile web add ./plugins/dsh-trace
```

每个插件的功能和配置细节见对应目录中的 README。

## 开发

环境要求：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.7.0`。

```sh
pnpm install --frozen-lockfile
pnpm check
```

常用命令：

```sh
pnpm build       # 构建全部插件
pnpm test        # 测试全部插件
pnpm typecheck   # 类型检查全部插件
pnpm clean       # 删除全部插件生成的 lib 和 tsbuildinfo
```

也可以只操作一个插件：

```sh
pnpm --filter @weekit/dsh-trace check
pnpm --filter @weekit/dsh-keybinding build
```

构建产物统一写入各插件的 `lib/`。`lib/` 仅用于本地运行和打包，由 Git 忽略，CI 会从源码重新构建。

## 发布

推送集合级 SemVer tag 会触发 [Release workflow](.github/workflows/release.yml)：

```sh
git tag -a v0.1.0 -m "oh-my-dsh-plugins v0.1.0"
git push origin v0.1.0
```

workflow 会完成全量检查，构建并打包三个插件，然后发布以下 GitHub Release 资产：

- `install.sh`
- `SHA256SUMS`
- `dsh-notify.tgz`
- `dsh-trace.tgz`
- `dsh-keybinding.tgz`

三个 tarball 内包含对应插件的 `lib/`，但 `lib/` 和根 `release/` 均不会提交到 Git。

## 扩展插件

新插件放入 `plugins/<plugin-name>`，并提供 `build`、`test`、`typecheck` 和 `check` 脚本。根 workspace 会自动发现 `plugins/*`；同时需要把包名加入 CI 插件矩阵，并把目录加入根 `install.sh` 的目标列表。
