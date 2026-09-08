import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage, matchesShortcut, normalizeKeyboardEvent, normalizeShortcut } from '../src/core/keybindings.ts'

describe('keybinding core', () => {
  it('normalizes modifiers and named keys into a stable form', () => {
    expect(normalizeShortcut(['shift', 'cmd', 'k', 'shift'])).toBe('Meta+Shift+K')
    expect(normalizeKeyboardEvent({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe('Mod+Shift+K')
  })

  it('keeps macOS Command and Control as distinct modifiers', () => {
    const platform = vi.spyOn(globalThis.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(normalizeKeyboardEvent({ key: 'k', code: 'KeyK', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true })).toBe('Mod+K')
    expect(normalizeKeyboardEvent({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe('Ctrl+K')
    platform.mockRestore()
  })

  it('persists a binding through the storage seam', () => {
    const storage = createMemoryStorage({ toggleTerminal: 'Mod+J' })
    storage.write({ toggleTerminal: 'Mod+K' })
    expect(storage.read()).toEqual({ toggleTerminal: 'Mod+K' })
  })

  it('matches Mod to the active platform modifier without matching the bare key', () => {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    const event = { key: 'j', code: 'KeyJ', ctrlKey: !mac, altKey: false, shiftKey: false, metaKey: mac }
    expect(matchesShortcut(event, 'Mod+J')).toBe(true)
    expect(matchesShortcut({ ...event, ctrlKey: false, metaKey: false }, 'Mod+J')).toBe(false)
  })
})
