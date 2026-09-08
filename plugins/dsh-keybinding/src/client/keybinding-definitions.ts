/** Shortcut metadata shared by the dispatcher and both settings surfaces. */
import type { KeybindingDefinition } from './keybinding-settings.tsx'

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  { id: 'sidebar.toggle', label: '切换侧边栏', defaultBinding: 'Mod+B' },
  { id: 'workspace.newSession', label: '新建工作区会话', defaultBinding: 'Mod+Shift+N' },
  { id: 'workspace.hints', label: '工作区快捷提示', defaultBinding: 'Mod+[' },
  { id: 'terminal.toggle', label: '切换终端', defaultBinding: 'Mod+J' },
  { id: 'terminal.focus', label: '聚焦终端', defaultBinding: 'Mod+Shift+J' },
  { id: 'terminal.new', label: '新建终端', defaultBinding: 'Mod+Shift+`' },
]
