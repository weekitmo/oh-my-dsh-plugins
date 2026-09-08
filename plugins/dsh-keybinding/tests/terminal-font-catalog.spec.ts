import { describe, expect, it } from 'vitest'
import type { Font } from 'fontkit'
import { discoverTerminalFonts, isTerminalMonospaceFont } from '../src/host/terminal-font-catalog.ts'

function fakeFont(options: { family?: string; variable?: boolean; noEmbedding?: boolean } = {}): Font {
  const family = options.family ?? 'Test Mono'
  return {
    familyName: family,
    subfamilyName: 'Regular',
    postscriptName: 'TestMono-Regular',
    post: { isFixedPitch: 1 },
    'OS/2': { fsType: { noEmbedding: options.noEmbedding ?? false, bitmapOnly: false } },
    getName: (key: string) => key === 'preferredFamily' ? family : null,
    hasGlyphForCodePoint: () => true,
    glyphForCodePoint: (codePoint: number) => ({ advanceWidth: options.variable && codePoint === 87 ? 700 : 600 }),
  } as unknown as Font
}

describe('system terminal font catalog', () => {
  it('accepts fixed-width terminal fonts and rejects proportional, hidden, or restricted faces', () => {
    expect(isTerminalMonospaceFont(fakeFont())).toBe(true)
    expect(isTerminalMonospaceFont(fakeFont({ variable: true }))).toBe(false)
    expect(isTerminalMonospaceFont(fakeFont({ family: '.Hidden Mono' }))).toBe(false)
    expect(isTerminalMonospaceFont(fakeFont({ noEmbedding: true }))).toBe(false)
  })

  it('preserves a manual font when system discovery is disabled', async () => {
    const fonts = await discoverTerminalFonts({
      configured: { family: 'Configured Mono', path: '/fonts/configured.ttf' },
      discoverSystemFonts: false,
    })

    expect(fonts).toHaveLength(1)
    expect(fonts[0]).toMatchObject({ family: 'Configured Mono', path: '/fonts/configured.ttf' })
    expect(fonts[0]?.id).toMatch(/^[a-f0-9]{20}$/)
  })
})
