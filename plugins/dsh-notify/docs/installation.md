# 安装说明

`@weekit/dsh-notify` 由 `oh-my-dsh-plugins` monorepo 统一构建和发布。

## 安装最新 Release

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-notify
```

安装到其他 profile：

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-notify --profile my-profile
```

安装器会下载 `dsh-notify.tgz` 和 `SHA256SUMS`，校验后将 tarball 缓存到 DSH 插件缓存目录，再加入指定 profile。

## 从源码安装

```sh
pnpm install --frozen-lockfile
pnpm --filter @weekit/dsh-notify run build
dsh plugin --profile web add ./plugins/dsh-notify
```

本地 checkout 不包含生成的 `lib/`，安装前必须构建。

## 卸载

```sh
dsh plugin --profile web remove @weekit/dsh-notify
```

安装或卸载后刷新 WebUI；若页面仍使用旧插件，重启对应的 `dsh web` 进程。

返回 [README](../README.md)。
