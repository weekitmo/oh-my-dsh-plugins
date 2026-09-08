/** Client half of the DSH keyboard shortcut and embedded terminal plugin. */
import { createLocalStorage } from '../core/keybindings.ts'
import { KeybindingRuntime } from './keybinding-runtime.tsx'
import { KeybindingSettingsSection, type KeybindingSettingsSectionProps } from './KeybindingSettingsSection.tsx'
import { TerminalControl } from './terminal-control.tsx'
import { TerminalPanel, type TerminalClientContext } from './terminal-panel.tsx'
import { createTerminalUiStore } from './terminal-store.ts'
import type { Context, IWorkspaces, ISessions, LayoutClient, PropsLocale, PropsRenderSlots, PropsRuntime, SessionClient } from './types.ts'

export { KeybindingController, KeybindingDispatcher, KeybindingSettings } from './keybinding-settings.tsx'
export type { KeybindingAction, KeybindingActions, KeybindingSettingsProps } from './keybinding-settings.tsx'
export { ShortcutRecorder } from './ShortcutRecorder.tsx'
export type { ShortcutRecorderProps } from './ShortcutRecorder.tsx'

export const inject = ['slots', 'workspaces', 'sessions', 'uiWorkspace', 'layout']

type OverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<string> & PropsRenderSlots<never>

export function apply(ctx: Context): void {
  const context: TerminalClientContext = {
    workspaces: ctx.get<IWorkspaces>('workspaces'),
    sessions: ctx.get<ISessions>('sessions'),
    uiWorkspace: ctx.get<SessionClient>('uiWorkspace'),
    layout: ctx.get<LayoutClient>('layout'),
  }
  const keybindings = createLocalStorage()
  const terminal = createTerminalUiStore()

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'keybinding-runtime', order: 50,
  }, (props: OverlayProps) => <KeybindingRuntime context={context} storage={keybindings} terminal={terminal} {...props} />))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'terminal-toggle', order: 80,
  }, () => <TerminalControl store={terminal} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'embedded-terminal', order: 80,
  }, () => <TerminalPanel context={context} store={terminal} />))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'keybindings', order: 90, label: 'Keybindings',
    inject: () => ({ storage: keybindings, terminal }),
  }, (props: Record<string, unknown>) => <KeybindingSettingsSection {...props as unknown as KeybindingSettingsSectionProps} />))
}
