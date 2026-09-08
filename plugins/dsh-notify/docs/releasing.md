# 版本与发布

本仓库使用集合级 Git tag 触发统一发布，tag 遵循 Semantic Versioning：

```sh
git tag -a v0.1.0 -m "oh-my-dsh-plugins v0.1.0"
git push origin v0.1.0
```

`.github/workflows/release.yml` 会在 `vX.Y.Z` tag 上执行：

1. 使用 frozen lockfile 安装依赖。
2. 运行 monorepo 全量 `pnpm check`。
3. 分别打包 `@weekit/dsh-notify`、`@weekit/dsh-trace` 和 `@weekit/dsh-keybinding`。
4. 将包重命名为稳定 Release 资产名：`dsh-notify.tgz`、`dsh-trace.tgz`、`dsh-keybinding.tgz`。
5. 生成 `SHA256SUMS`，并将根 `install.sh` 一同发布到 GitHub Release。

集合 release 版本与插件自身 package version 分离。每个 tarball 内保留对应 `package.json` 的真实版本；稳定资产名让远程安装器无需猜测包版本。

发布前不要提交任何 `lib/`。workflow 会从源码重新构建，并只把生成的 `lib/` 放入 tarball 和临时 GitHub Actions artifact。

返回 [README](../README.md)。
