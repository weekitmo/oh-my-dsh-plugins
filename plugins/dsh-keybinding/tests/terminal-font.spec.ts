// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { loadTerminalFont, resolveTerminalFont } from '../src/client/terminal-font.ts'

describe('terminal font resolution', () => {
  it('prefers Maple Mono NF CN before the DSH code font', () => {
    const host = document.createElement('div')
    host.style.setProperty('--ds-font-family-code', '"DSH Code", monospace')
    document.body.append(host)

    const font = resolveTerminalFont('', host)

    expect(font.startsWith('"Maple Mono NF CN", "DSH Code"')).toBe(true)
    expect(font).toContain('"Symbols Nerd Font Mono"')
    expect(font.endsWith('monospace')).toBe(true)
  })

  it('keeps Maple Mono after a configured family and before the DSH fallback', () => {
    const host = document.createElement('div')
    host.style.setProperty('--ds-font-family-code', 'Menlo')
    document.body.append(host)

    expect(resolveTerminalFont('Custom Mono', host).startsWith('Custom Mono, "Maple Mono NF CN", Menlo')).toBe(true)
  })

  it('loads regular and bold faces with Powerline and Nerd Font samples', async () => {
    const load = vi.fn(async (_font: string, _text?: string) => [])

    await loadTerminalFont('"Maple Mono NF CN", monospace', 13, { load } as unknown as FontFaceSet)

    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.calls.map(call => call[0])).toEqual([
      '400 13px "Maple Mono NF CN", monospace',
      '700 13px "Maple Mono NF CN", monospace',
    ])
    expect(load.mock.calls.every(call => String(call[1]).includes('\ue0a0'))).toBe(true)
  })
})
