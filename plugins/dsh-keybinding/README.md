# @weekit/dsh-keybinding

DSH Web keyboard shortcut plugin with an integrated interactive terminal.

## Scope

This project does not depend on `dsh-better-sidebar`. It owns its own:

- local PTY process and shell environment;
- authenticated WebSocket upgrade route;
- bounded transcript replay;
- private OSC workspace command protocol;
- browser terminal surface and `ws` / `ws --open` Workspace actions.

The DSH host provides only its public composition seams. When loaded into DSH,
this plugin expects the standard `webServer`, `connection`, `workspaces`,
`sessions`, and `uiWorkspace` services. `connection.requestRejection()` is
applied before the WebSocket upgrade is accepted, so the terminal route does
not bypass the browser authentication fence.

## Commands

Inside the terminal:

```text
ws
ws --open
```

`ws` registers the current physical directory and switches DSH Web to that
Workspace. When the current Session belongs to another Workspace, it starts a
Session in the target Workspace. The target Workspace and selected Session are
scrolled into the visible sidebar range. Running `ws` again from the active
Workspace keeps the current Session. `ws --open` is accepted as an equivalent
explicit form.

## Installation

Install this scoped plugin from the latest GitHub Release:

```sh
curl -fsSL https://github.com/weekitmo/oh-my-dsh-plugins/releases/latest/download/install.sh | sh -s -- @weekit/dsh-keybinding
```

The installer verifies the release tarball and allows the `node-pty` native dependency to select or build its platform binary. Use `--profile <name>` after the package name to install into another profile.

## Development

The pure protocol and transcript modules can be tested in this checkout:

```bash
pnpm install
pnpm test
pnpm typecheck
```

The package's DSH adapter is loaded by a DSH profile as a normal plugin. DSH
monorepo packages must be available at runtime through the profile; they are
not copied into this repository and `dsh-better-sidebar` is not a dependency.

## Architecture

`src/core` is the framework-free module for frame validation, Workspace action
decoding, private-frame filtering, bounded transcript replay, and the PTY seam.
`src/host` adapts it to DSH's webserver and connection services. `src/client`
keeps the global shortcut dispatcher in `shell.overlay`, contributes a compact
toggle through `conversation.input.left`, and mounts the visible terminal in
the in-flow `conversation.input.dock` slot.

The browser terminal uses xterm.js for VT/ANSI/OSC processing, input, selection,
scrollback, cursor behavior, and PTY sizing. Its top edge resizes the dock without
covering the right-side workbench. New terminals start in the Workspace that
contains the current DSH Session; reconnecting an existing terminal preserves
its running shell and current directory. The renderer inherits DSH color tokens
and loads regular and bold faces before xterm measures its cells. Its font order
is the configured family, `Maple Mono NF CN`, DSH's code font, common Nerd Font
families, and monospace.

Shortcut and terminal appearance editing is available from the `Keybindings`
page in DSH Web's main Settings dialog. The settings update the active dispatcher
and terminal immediately. Shortcut bindings persist under
`dsh-keybinding.keybindings`; terminal font and size persist under
`dsh-keybinding.terminal`. Existing bindings under the earlier
`dsh-web-terminal.keybindings` key remain readable as a compatibility fallback.
Configured shortcuts are captured before page listeners and prevent the browser
default when Chromium delivers a cancellable key event; browser-reserved commands
that are never delivered to page JavaScript cannot be overridden. The default
`Mod+[` binding enters Workspace hint mode: visible Workspace and session rows
receive home-row-first letter buttons. Typing a button's label or clicking it
invokes that row's normal DSH action, and `Escape` exits without switching. The
Workspace hint shortcut remains global when DSH focuses its editable composer,
so another hint selection does not require a preliminary mouse click.
Shortcut fields look like editable inputs; focusing one listens for a real key
combination, while Shift/Ctrl/Command/Alt buttons provide a fallback when the
browser reserves a shortcut before it reaches the page.

## Keybinding Integration

The client export also exposes `KeybindingAction`, `KeybindingController`,
`KeybindingDispatcher`, `KeybindingSettings`, and `ShortcutRecorder`. A sidebar
plugin can provide its own public action definitions, for example an action
with `id: "sidebar.toggle"`, `label`, `defaultBinding`, and `run()`. The
recorder normalizes Cmd/Ctrl as the portable `Mod` modifier, previews the
combination while recording, persists the map through `KeyBindingStorage`, and
ignores editable controls during global dispatch. This is an integration seam,
not an implementation dependency on `dsh-better-sidebar`.
