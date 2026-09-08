/** Invisible global shortcut dispatcher backed by plugin stores and DSH services. */
import { useMemo, useState } from 'react'
import type { KeyBindingStorage } from '../core/keybindings.ts'
import { KEYBINDING_DEFINITIONS } from './keybinding-definitions.ts'
import { KeybindingDispatcher, useKeyBindings, type KeybindingAction } from './keybinding-settings.tsx'
import type { TerminalClientContext } from './terminal-panel.tsx'
import type { TerminalUiStore } from './terminal-store.ts'
import { WorkspaceHints } from './workspace-hints.tsx'

/**
 * Install global shortcut behavior without rendering visible UI.
 * @param props - Shared storage, terminal commands, and DSH navigation services.
 * @returns The global keydown dispatcher.
 */
export function KeybindingRuntime({ storage, terminal, context }: {
  storage: KeyBindingStorage
  terminal: TerminalUiStore
  context: TerminalClientContext
}) {
  const [hintActivation, setHintActivation] = useState(0)
  const definitions = useMemo<readonly KeybindingAction[]>(() => {
    const runs: Record<string, () => void> = {
      'sidebar.toggle': () => context.layout?.toggleSidebar(),
      'workspace.newSession': () => context.uiWorkspace.startSession(),
      'workspace.hints': () => setHintActivation(value => value + 1),
      'terminal.toggle': terminal.toggle,
      'terminal.focus': terminal.focus,
      'terminal.new': terminal.newTerminal,
    }
    return KEYBINDING_DEFINITIONS.map(definition => ({
      ...definition,
      ...(definition.id === 'workspace.hints' ? { allowEditableTarget: true } : {}),
      run: runs[definition.id] ?? (() => {}),
    }))
  }, [context, terminal])
  const state = useKeyBindings(storage, definitions)
  return <>
    <KeybindingDispatcher bindings={state.bindings} definitions={definitions} />
    <WorkspaceHints activation={hintActivation} />
  </>
}
