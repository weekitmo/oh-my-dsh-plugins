# AGENTS.md

- Plugin source is grouped by feature under `plugins/<plugin-name>/`.
- Keep package-specific implementation, tests, and documentation inside its plugin directory.
- Generated output belongs in `plugins/*/lib/` and must remain untracked.
- Release staging belongs in root `release/` and must remain untracked.
- Run `pnpm check` from the repository root before release.
- Keep plugins installable without modifying the DeepSeek Harness source tree.
- When adding a plugin, add its package name to the GitHub Actions matrix and its directory to the root installer.
