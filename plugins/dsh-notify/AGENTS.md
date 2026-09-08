# AGENTS.md

- Source lives in `src/`; browser code lives in `src/client/`.
- `lib/` is a generated build directory and must stay untracked; CI builds it before packaging release artifacts.
- Run `pnpm check` before release.
- Keep the plugin installable without modifying DeepSeek Harness.
