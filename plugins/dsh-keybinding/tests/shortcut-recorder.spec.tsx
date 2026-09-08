import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutRecorder } from '../src/client/ShortcutRecorder.tsx'

afterEach(cleanup)

describe('ShortcutRecorder', () => {
  it('shows recording state, normalizes a keydown, and writes it back', () => {
    const onChange = vi.fn()
    render(<ShortcutRecorder label="Toggle terminal" value="Mod+J" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Toggle terminal' })
    fireEvent.click(input)
    expect((input as HTMLInputElement).value).toBe('请按下快捷键…')
    fireEvent.keyDown(input, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect((input as HTMLInputElement).value).toBe('Mod')
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true })
    expect(onChange).toHaveBeenCalledWith('Mod+Shift+K')
    expect((input as HTMLInputElement).value).toBe('Mod+J')
  })

  it('records explicit Control on macOS and displays Command clearly', () => {
    const platform = vi.spyOn(globalThis.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const onChange = vi.fn()
    render(<ShortcutRecorder label="Workspace hints" value="Mod+[" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Workspace hints' })
    expect((input as HTMLInputElement).value).toBe('Command + [')
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', ctrlKey: true })
    expect(onChange).toHaveBeenCalledWith('Ctrl+K')
    platform.mockRestore()
  })

  it('builds a shortcut with the modifier buttons', () => {
    const onChange = vi.fn()
    render(<ShortcutRecorder label="Workspace hints" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Workspace hints' })
    fireEvent.click(input)
    fireEvent.click(screen.getByRole('button', { name: 'Shift 修饰键' }))
    expect(screen.getByRole('button', { name: 'Shift 修饰键' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', shiftKey: false })
    expect(onChange).toHaveBeenCalledWith('Shift+K')
  })

  it('clears a binding with Backspace and cancels with Escape', () => {
    const onChange = vi.fn()
    render(<ShortcutRecorder label="Focus terminal" value="Mod+Shift+J" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Focus terminal' })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith('')
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
