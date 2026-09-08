// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { getTerminalWebFontFamilies, loadTerminalFont, loadTerminalWebFont, resolveTerminalFont } from '../src/client/terminal-font.ts'

describe('terminal font resolution', () => {
  it('uses the DSH code font when no terminal web font is selected', () => {
    const host = document.createElement('div')
    host.style.setProperty('--ds-font-family-code', '"DSH Code", monospace')
    document.body.append(host)

    const font = resolveTerminalFont('', host)

    expect(font.startsWith('"DSH Code"')).toBe(true)
    expect(font).toContain('"Symbols Nerd Font Mono"')
    expect(font.endsWith('monospace')).toBe(true)
  })

  it('maps the common IosevkaTerm Nerd Font alias to the installed Nerd family', () => {
    const host = document.createElement('div')
    document.body.append(host)

    expect(resolveTerminalFont('IosevkaTerm Nerd Font Mono', host).startsWith('"Iosevka Nerd Font Mono",')).toBe(true)
  })

  it('keeps the configured family before the DSH fallback', () => {
    const host = document.createElement('div')
    host.style.setProperty('--ds-font-family-code', 'Menlo')
    document.body.append(host)

    expect(resolveTerminalFont('Custom Mono', host).startsWith('Custom Mono, Menlo')).toBe(true)
  })

  it('injects the authenticated same-origin font stylesheet', async () => {
    const css = '@font-face { font-family: "Iosevka Nerd Font Mono"; src: url(/dsh-terminal/font-file); }'
    const fetcher = vi.fn(async (_input: string) => ({ ok: true, text: async () => css }))

    await loadTerminalWebFont(fetcher, document)

    expect(fetcher).toHaveBeenCalledWith('/dsh-terminal/font.css')
    expect(document.querySelector('style[data-dsh-terminal-font]')?.textContent).toBe(css)
    expect(getTerminalWebFontFamilies(document)).toEqual(['Iosevka Nerd Font Mono'])
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
