# Planning Index

Task planning records are stored in dated subdirectories and intentionally ignored by Git.

- `2026-09-07-plugin-monorepo-migration/` - consolidate notify, trace, and keybinding plugins
- `2026-09-08-terminal-font-debug/` - diagnose and fix Iosevka terminal font resolution
- `2026-09-09-delegate-agent-migration/` - migrate and validate the external agent delegation plugin
- `2026-09-09-delegate-agent-ui-hardening/` - dark-mode fix, mobile checks, trace-style stdout timeline, highlighted final-result view, and named delegation presets for the delegate plugin
- `2026-09-14-harness-0.1.5-rc.2-plugin-sync/` - sync plugin manifests, lockfile, and READMEs to DeepSeek Harness `>=0.1.5-rc.2`; cut release baseline `v0.1.4`
- `2026-09-17-v0.1.4-release-and-install/` - push the rc.2 sync commit, publish the `v0.1.4` release, and install the four plugins into the local web profile without restarting the running `dsh web`
- `2026-09-17-delegate-trace-rpc-broken/` - diagnose why the delegate-agent and trace plugins are unusable on DSH 0.1.5-rc.2 (their `connection.rpc.handle` channels never register because `owner.webServer` cannot resolve) and pick a fix
