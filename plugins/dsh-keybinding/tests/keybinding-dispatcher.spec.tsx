import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeybindingController, KeybindingDispatcher, KeybindingSettings, type KeybindingAction } from '../src/client/keybinding-settings.tsx'
import { createMemoryStorage } from '../src/core/keybindings.ts'

afterEach(cleanup)

describe('KeybindingDispatcher', () => {
  it('dispatches an injected action and ignores editable targets', () => {
    const run = vi.fn()
    const definitions: readonly KeybindingAction[] = [{ id: 'sidebar.toggle', label: 'Toggle sidebar', defaultBinding: 'Mod+B', run }]
    const bindings = { 'sidebar.toggle': 'Mod+B' }
    render(<KeybindingDispatcher bindings={bindings} definitions={definitions} />)

    fireEvent.keyDown(document.body, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('runs explicitly global shortcuts from an editable composer target', () => {
    const run = vi.fn()
    const definitions: readonly KeybindingAction[] = [{ id: 'workspace.hints', label: 'Workspace hints', defaultBinding: 'Mod+[', allowEditableTarget: true, run }]
    render(<KeybindingDispatcher bindings={{ 'workspace.hints': 'Mod+[' }} definitions={definitions} />)
    const composer = document.createElement('textarea')
    document.body.append(composer)

    fireEvent.keyDown(composer, { key: '[', code: 'BracketLeft', ctrlKey: true })

    expect(run).toHaveBeenCalledTimes(1)
    composer.remove()
  })

  it('does not dispatch global actions while their recorder owns the key event', () => {
    const run = vi.fn()
    const storage = createMemoryStorage({ 'workspace.hints': 'Mod+[' })
    const definitions: readonly KeybindingAction[] = [
      { id: 'workspace.hints', label: 'Workspace hints', defaultBinding: 'Mod+[', allowEditableTarget: true, run },
    ]
    render(<>
      <KeybindingController storage={storage} definitions={definitions} showSettings={false} />
      <KeybindingSettings storage={storage} definitions={definitions} />
    </>)
    const input = document.querySelector('input[aria-label="Workspace hints"]')
    if (input === null) throw new Error('shortcut recorder did not render')

    fireEvent.click(input)
    fireEvent.keyDown(input, { key: '[', code: 'BracketLeft', ctrlKey: true })

    expect(run).not.toHaveBeenCalled()
  })

  it('applies a binding edited from a second settings surface immediately', () => {
    const run = vi.fn()
    const storage = createMemoryStorage({ 'terminal.toggle': 'Mod+J' })
    const definitions: readonly KeybindingAction[] = [
      { id: 'terminal.toggle', label: 'Toggle terminal', defaultBinding: 'Mod+J', run },
    ]
    render(<>
      <KeybindingController storage={storage} definitions={definitions} showSettings={false} />
      <KeybindingSettings storage={storage} definitions={definitions} />
    </>)

    const input = document.querySelector('input[aria-label="Toggle terminal"]')
    if (input === null) throw new Error('shortcut recorder did not render')
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true })

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('captures configured browser-reserved shortcuts before later listeners', () => {
    const platform = vi.spyOn(globalThis.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const run = vi.fn()
    const later = vi.fn()
    const definitions: readonly KeybindingAction[] = [{ id: 'workspace.hints', label: 'Workspace hints', defaultBinding: 'Mod+[', run }]
    render(<KeybindingDispatcher bindings={{ 'workspace.hints': 'Mod+[' }} definitions={definitions} />)
    document.addEventListener('keydown', later)

    const event = new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    document.removeEventListener('keydown', later)

    expect(event.defaultPrevented).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
    platform.mockRestore()
  })

  it('keeps the storage seam independent from the action implementation', () => {
    const storage = createMemoryStorage({ 'sidebar.toggle': 'Mod+B' })
    expect(storage.read()['sidebar.toggle']).toBe('Mod+B')
  })
})
