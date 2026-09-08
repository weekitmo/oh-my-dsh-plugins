/** Settings surfaces and dispatcher for persisted keyboard shortcuts. */
import { useEffect, useMemo, useState } from 'react'
import { isEditableTarget, matchesShortcut, type KeyBindingMap, type KeyBindingStorage } from '../core/keybindings.ts'
import { ShortcutRecorder } from './ShortcutRecorder.tsx'

export interface KeybindingDefinition {
  id: string
  label: string
  defaultBinding?: string
}

export interface KeybindingAction extends KeybindingDefinition {
  allowEditableTarget?: boolean
  run(): void
}

export interface KeybindingActions {
  toggleTerminal(): void
  focusTerminal(): void
  newTerminal(): void
}

export interface KeybindingSettingsProps {
  storage: KeyBindingStorage
  actions?: KeybindingActions
  definitions?: readonly KeybindingDefinition[]
  bindings?: KeyBindingMap
  onBindingsChange?: (bindings: KeyBindingMap) => void
}

function defaultDefinitions(actions: KeybindingActions): readonly KeybindingAction[] {
  return [
    { id: 'toggleTerminal', label: '切换终端', defaultBinding: 'Mod+J', run: actions.toggleTerminal },
    { id: 'focusTerminal', label: '聚焦终端', defaultBinding: 'Mod+Shift+J', run: actions.focusTerminal },
    { id: 'newTerminal', label: '新建终端', defaultBinding: 'Mod+Shift+`', run: actions.newTerminal },
  ]
}

/**
 * Keep one React view synchronized with the shared browser storage adapter.
 * @param storage - Shared persistence adapter created by the client plugin.
 * @param definitions - Definitions supplying defaults for missing bindings.
 * @returns Current bindings and a write-through update callback.
 */
export function useKeyBindings(storage: KeyBindingStorage, definitions: readonly KeybindingDefinition[]) {
  const resolve = (): KeyBindingMap => ({
    ...Object.fromEntries(definitions.map(definition => [definition.id, definition.defaultBinding ?? ''])),
    ...storage.read(),
  })
  const [bindings, setBindings] = useState<KeyBindingMap>(resolve)
  useEffect(() => {
    setBindings(resolve())
    return storage.subscribe?.(() => setBindings(resolve()))
  }, [storage, definitions])
  const update = (next: KeyBindingMap): void => {
    setBindings(next)
    storage.write(next)
  }
  return { bindings, update }
}

export function KeybindingController({ storage, actions, definitions, showSettings }: KeybindingSettingsProps & { showSettings: boolean }) {
  const resolvedDefinitions = useMemo(
    () => definitions ?? (actions === undefined ? [] : defaultDefinitions(actions)),
    [actions, definitions],
  )
  const actionDefinitions = useMemo(
    () => resolvedDefinitions.filter((definition): definition is KeybindingAction => 'run' in definition),
    [resolvedDefinitions],
  )
  const { bindings, update } = useKeyBindings(storage, resolvedDefinitions)
  return <>
    <KeybindingDispatcher bindings={bindings} definitions={actionDefinitions} />
    {showSettings && <KeybindingSettings storage={storage} definitions={resolvedDefinitions} bindings={bindings} onBindingsChange={update} />}
  </>
}

export function KeybindingSettings({ storage, actions: suppliedActions, definitions: suppliedDefinitions, bindings: suppliedBindings, onBindingsChange }: KeybindingSettingsProps) {
  const definitions = useMemo(
    () => suppliedDefinitions ?? (suppliedActions === undefined ? [] : defaultDefinitions(suppliedActions)),
    [suppliedActions, suppliedDefinitions],
  )
  const local = useKeyBindings(storage, definitions)
  const bindings = suppliedBindings ?? local.bindings
  const update = (next: KeyBindingMap): void => {
    if (suppliedBindings === undefined) local.update(next)
    else onBindingsChange?.(next)
  }
  return <section aria-label="键盘快捷键" style={{ boxSizing: 'border-box', width: '100%', minWidth: 0, display: 'grid', alignContent: 'start', gap: 12, padding: 16 }}>
    <h3 style={{ margin: 0 }}>键盘快捷键</h3>
    {definitions.map(definition => <ShortcutRecorder
      key={definition.id}
      label={definition.label}
      value={bindings[definition.id] ?? ''}
      onChange={value => update({ ...bindings, [definition.id]: value })}
    />)}
  </section>
}

export function KeybindingDispatcher({ bindings, definitions }: { bindings: KeyBindingMap; definitions: readonly KeybindingAction[] }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-dsh-keybinding-recorder]') !== null) return
      const pluginSurface = target?.closest('[data-dsh-keybinding-global]') !== null
      const definition = definitions.find(item => bindings[item.id] !== undefined && matchesShortcut(event, bindings[item.id] ?? ''))
      if (definition === undefined) return
      if (isEditableTarget(event.target) && !pluginSurface && definition.allowEditableTarget !== true) return
      event.preventDefault()
      event.stopImmediatePropagation()
      definition.run()
    }
    document.addEventListener('keydown', listener, true)
    return () => document.removeEventListener('keydown', listener, true)
  }, [bindings, definitions])
  return null
}
