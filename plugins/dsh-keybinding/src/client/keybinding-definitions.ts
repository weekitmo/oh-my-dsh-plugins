/** Shortcut metadata shared by the dispatcher and both settings surfaces. */
import type { KeybindingDefinition } from './keybinding-settings.tsx'

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  { id: 'sidebar.toggle', label: 'Toggle sidebar', defaultBinding: 'Mod+B' },
  { id: 'workspace.newSession', label: 'New workspace session', defaultBinding: 'Mod+Shift+N' },
  { id: 'workspace.hints', label: 'Workspace hints', defaultBinding: 'Mod+[' },
  { id: 'terminal.toggle', label: 'Toggle terminal', defaultBinding: 'Mod+J' },
  { id: 'terminal.focus', label: 'Focus terminal', defaultBinding: 'Mod+Shift+J' },
  { id: 'terminal.new', label: 'New terminal', defaultBinding: 'Mod+Shift+`' },
]
