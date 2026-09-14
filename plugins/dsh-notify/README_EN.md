# @weekit/dsh-notify

English | [简体中文](README.md)

[![CI](https://github.com/weekitmo/oh-my-dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/weekitmo/oh-my-dsh-plugins/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/weekitmo/oh-my-dsh-plugins)](https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A task status notification plugin for DeepSeek Harness. It provides clear status updates through system notifications, the browser tab title, and the session list when a task is running, completed, or interrupted by an error.

## DSH version compatibility

The current release requires DeepSeek Harness `>=0.1.5-rc.2`. For DSH versions below `0.1.5-rc.2`, use the legacy release `v0.1.3` instead of the current release tarball.


- **System notifications**: Receive completion, failure, abort, block, or token-limit results only after a top-level task fully settles. Each result type can be disabled separately.
- **DingTalk robot**: Configure an Access Token and Signing Secret, independently select success/completion or failure/abort messages, and use do-not-disturb with a missed-message summary.
- **Tab status**: Shows the latest workspace session title while idle, a spinner and session count while running, and an unread result count after completion or failure.
- **Sidebar indicators**: Shows a green dot for an unread completed session and a red dot for an error, abort, block, or token limit. Opening the session clears the indicator.
- **Native state compatibility**: Active sessions keep the built-in DSH loading state, while approval and question prompts keep their native warning state.
- **Configurable behavior**: Control notification permissions, tab animation, favicon, spinner, sidebar indicators, and result types under **Settings > Notifications** in the WebUI.

## Architecture

`@weekit/dsh-notify` is a standard Cordis Host/Client plugin and does not modify DeepSeek Harness core. It uses DSH Session events, Session Projection, Client Runtime, and UI Slot extension points; it is not an adapter built on the external CLI hooks under `packages/hooks/*`.

```mermaid
flowchart TB
  subgraph Host[DSH Host / Cordis]
    Events[Session event log] --> Projection[dshNotify Session Projection]
    Events --> Coordinator[Task completion coordinator]
    Agents[Agent status] --> Coordinator
    Jobs[Job status] --> Coordinator
    Coordinator --> HostFilter{Task fully settled?}
    HostFilter -->|no| PendingHost[Keep or cancel candidate]
    HostFilter -->|yes| DingQueue[Durable DingTalk queue]
    DingQueue --> DingTalk[DingTalk robot]
    SettingsApi[Same-origin loopback settings route] --> DingQueue
  end

  subgraph Web[DSH Web Client]
    Projection --> SessionList[sessions.list projection snapshots]
    SessionList --> ClientState[pending / published state machine]
    ClientState --> ClientFilter{Task fully settled?}
    ClientFilter -->|no| PendingClient[Keep or cancel candidate]
    ClientFilter -->|yes| Unread[Final AttentionEntry]
    Unread --> System[Browser system notification]
    Unread --> Title[Aggregated document.title]
    Unread --> Sidebar[Sidebar status indicator]
    SessionList --> Running[Fold running subagents into visible parent]
    Running --> Title
    LocalSettings[localStorage settings] --> System
    LocalSettings --> Title
    LocalSettings --> Sidebar
    Slot[settings.section UI Slot] --> LocalSettings
    Slot --> SettingsApi
  end
```

The Host entry registers the projection with `ctx.sessionProjections.register(...)` and coordinates Session, Agent, and Job lifecycle signals. The Client subscribes to `sessions.list` and reevaluates candidates on every snapshot. Both sides use a short cancellable convergence window to cover the race where a settled job synchronously wakes the main Agent with a followup.

Subagent Sessions carry `origin: 'subagent'`. Both the Host DingTalk path and the browser system-notification, unread-tab, and sidebar paths filter them before a candidate becomes a final result. There is therefore no subagent-success switch today. Running subagents are still folded into their visible parent's running count.

`turn/end` creates only a pending candidate. Publication requires the top-level session to be idle, no running/stopping jobs in the task or its subagent descendants, no running subagent descendants, no active automatic goal, and no unsettled async delegation at turn end. COI, background subagent/bash, workflow, and goal launch turns remain suppressed while delegated work is unsettled. A turn that explicitly waits for and collects every terminal result may still publish as the final summary; otherwise a later main-Agent summary replaces the candidate and notifies after convergence. An ordinary GUI fork has no `origin: 'subagent'` and remains an independently notifiable task.

## Installation

Install this scoped package from the latest GitHub Release:

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-notify
```

The installer downloads and verifies the prebuilt tarball, then adds it to the `web` profile. To select another profile:

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-notify --profile my-profile
```

Refresh the WebUI after installation. If the plugin does not load automatically, restart the corresponding `dsh web` process and refresh the page again. See the repository root [README](../../README.md) for all installer options.

## Enable and Use

1. Open **Settings > Notifications** in the WebUI.
2. Enable the notification features you need.
3. For system notifications, click **Request permission** and allow notifications in the browser prompt.
4. For DingTalk notifications, open the official setup guide from the DingTalk group, create a custom robot, enter its Access Token and Signing Secret, select the outcomes to send, and save.
5. Keep the defaults or adjust tab indicators, the running spinner, sidebar indicators, and result types.

DingTalk outcome filters are independent from browser notification switches. Disabling system notifications or a local outcome does not disable an enabled DingTalk category. After browser notification permission has been denied, the page cannot force the permission prompt to appear again. Re-enable notifications in the site's permission settings from the browser address bar.

## Configuration

Browser settings are stored in `localStorage` for the current site. The defaults are:

| Setting | Default |
| --- | --- |
| System notifications | On |
| Maximum system notification body characters | 400 (range 100–2000) |
| Independent subagent completion notifications | Off (fixed; only folded into parent running counts) |
| Unread result summary in the tab | On |
| Running spinner in the tab | On |
| Idle tab title animation | On |
| Hidden-page idle favicon indicator | Off |
| Green/red sidebar indicators | On |
| All five result types | On |
| Unread result animation | Marquee |
| DingTalk success/completed messages | On (after credentials are configured) |
| DingTalk failed/aborted messages | On (includes errors, blocks, and token limits) |
| DingTalk do not disturb | Off (default window 23:00-08:00) |
| Missed-message summary after do not disturb | Off |

DingTalk credentials and policy are stored in `$DSH_HOME/dsh-notify/settings.json`, never in browser `localStorage`, and the API never returns credentials to the page. Credential management accepts only same-origin WebUI requests over a local loopback address; DingTalk settings cannot be changed through a LAN or public WebUI address. Do not disturb uses `Asia/Shanghai`, supports overnight ranges, and persists held messages in `dingtalk-missed.json` before sending one digest at the end. Ordinary task results also enter this durable queue before delivery and retry after failure or restart. Delivery is at least once: an extreme crash window may duplicate a message, but does not silently lose it. Rotating robot credentials clears the old queue before saving the new credentials, and disabling an outcome category removes matching pending messages. POSIX systems use a `0700` directory and `0600` files; Windows relies on the current user's file ACL while still rejecting symlinks and non-regular files.

The maximum system notification body length can be changed directly in the dsh-notify settings page and takes effect immediately.

## Uninstall

```sh
dsh plugin --profile web remove @weekit/dsh-notify
```

Refresh the page. If the plugin is still present, restart the corresponding `dsh web` process.

## Additional Documentation

- [Installation guide](docs/installation.md): Monorepo and manual installation commands.
- [Development guide](docs/development.md): Known limitations, local development, and validation commands.
- [Versioning and releases](docs/releasing.md): Versioning rules and the maintainer release process.

## License

MIT. See [LICENSE](LICENSE).
