/** Framework-free keyboard normalization, matching, and persistence primitives. */

export type ShortcutAction = 'toggleTerminal' | 'focusTerminal' | 'newTerminal'

export interface KeyBindingMap {
  [action: string]: string | undefined
}

export interface KeyBindingStorage {
  read(): KeyBindingMap
  write(bindings: KeyBindingMap): void
  subscribe?(listener: () => void): () => void
}

export const DEFAULT_KEYBINDINGS: Readonly<Record<ShortcutAction, string>> = {
  toggleTerminal: 'Mod+J',
  focusTerminal: 'Mod+Shift+J',
  newTerminal: 'Mod+Shift+`',
}

const MODIFIERS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta', 'Mod'])
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const
const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space', Escape: 'Esc', 'Esc': 'Esc', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', 'Backspace': 'Backspace',
  Delete: 'Delete', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', 'Dead': 'Dead',
}

export function normalizeShortcut(parts: readonly string[]): string {
  const modifiers = new Set<string>()
  let key: string | undefined
  for (const raw of parts) {
    const token = normalizeToken(raw)
    if (token === undefined) continue
    if (MODIFIERS.has(token)) modifiers.add(token)
    else key = token
  }
  if (key === undefined) return ''
  const ordered = MODIFIER_ORDER.filter(modifier => modifiers.has(modifier))
  return [...ordered, key].join('+')
}

export function normalizeKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  const modifiers: string[] = []
  if (isMac()) {
    if (event.metaKey) modifiers.push('Mod')
    if (event.ctrlKey) modifiers.push('Ctrl')
  } else {
    if (event.ctrlKey) modifiers.push('Mod')
    if (event.metaKey) modifiers.push('Meta')
  }
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  const key = event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta'
    ? ''
    : normalizeToken(event.key) ?? normalizeCode(event.code)
  return normalizeShortcut([...modifiers, key ?? ''])
}

export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, shortcut: string): boolean {
  const normalized = normalizeShortcut(shortcut.split('+'))
  if (normalized.length === 0) return false
  const actual = normalizeKeyboardEvent(event)
  const expected = isMac() ? normalized.replace(/^Meta\+/, 'Mod+') : normalized.replace(/^Ctrl\+/, 'Mod+')
  return actual === expected
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = typeof HTMLElement !== 'undefined' && target instanceof HTMLElement ? target : null
  if (element === null) return false
  return element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
}

export function createMemoryStorage(initial: KeyBindingMap = {}): KeyBindingStorage {
  let value = { ...initial }
  const listeners = new Set<() => void>()
  return {
    read: () => ({ ...value }),
    write: next => {
      value = { ...next }
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createLocalStorage(storageKey = 'dsh-keybinding.keybindings'): KeyBindingStorage {
  const legacyStorageKey = 'dsh-web-terminal.keybindings'
  const listeners = new Set<() => void>()
  return {
    read: () => {
      try {
        const raw = globalThis.localStorage.getItem(storageKey)
          ?? (storageKey === 'dsh-keybinding.keybindings' ? globalThis.localStorage.getItem(legacyStorageKey) : null)
        if (raw === null) return {}
        const parsed: unknown = JSON.parse(raw)
        return isMap(parsed) ? parsed : {}
      } catch { return {} }
    },
    write: next => {
      try { globalThis.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* private browsing */ }
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function normalizeToken(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const lowered = trimmed.toLowerCase()
  if (lowered === 'cmd' || lowered === 'command' || lowered === 'meta' || lowered === '⌘') return 'Meta'
  if (lowered === 'ctrl' || lowered === 'control' || lowered === '⌃') return 'Ctrl'
  if (lowered === 'option' || lowered === 'alt' || lowered === '⌥') return 'Alt'
  if (lowered === 'shift' || lowered === '⇧') return 'Shift'
  if (lowered === 'mod') return 'Mod'
  if (NAMED_KEYS[trimmed] !== undefined) return NAMED_KEYS[trimmed]
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase()
  return Array.from(trimmed).length === 1 ? trimmed.toUpperCase() : trimmed
}

function normalizeCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  return normalizeToken(code)
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

function isMap(value: unknown): value is KeyBindingMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(item => item === undefined || typeof item === 'string')
}
