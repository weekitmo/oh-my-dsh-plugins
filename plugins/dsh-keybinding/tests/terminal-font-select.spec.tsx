// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalFontSelect } from '../src/client/TerminalFontSelect.tsx'

afterEach(cleanup)

describe('TerminalFontSelect', () => {
  it('disables selection when the host has no configured web font', () => {
    render(<TerminalFontSelect options={[]} value="" onChange={vi.fn()} />)

    const trigger = screen.getByRole('combobox', { name: '终端字体' }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain('未配置可用字体')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens a custom listbox and selects a detected font', () => {
    const onChange = vi.fn()
    render(<TerminalFontSelect options={['Iosevka Nerd Font Mono']} value="" onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: '终端字体' })

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: 'Iosevka Nerd Font Mono' }))

    expect(onChange).toHaveBeenCalledWith('Iosevka Nerd Font Mono')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
