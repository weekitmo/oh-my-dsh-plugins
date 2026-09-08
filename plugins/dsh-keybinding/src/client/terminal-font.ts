import { TERMINAL_FONT_CSS_PATH } from '../core/protocol.ts'

/** Terminal font resolution and browser loading for Nerd Font glyphs. */
const TERMINAL_FONT_SAMPLE = `M\ue0a0\ue0b0\uf101\uf120`

const FONT_ALIASES = new Map([
  ['IosevkaTerm Nerd Font Mono', '"Iosevka Nerd Font Mono"'],
])

const ICON_FONTS = [
  '"Symbols Nerd Font Mono"', '"Symbols Nerd Font"',
  '"Hack Nerd Font Mono"', '"JetBrainsMono Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"', '"CaskaydiaCove Nerd Font Mono"',
  '"SauceCodePro Nerd Font Mono"', '"UbuntuMono Nerd Font Mono"',
  '"Iosevka Nerd Font Mono"', '"Iosevka Term"',
  '"MesloLGS Nerd Font Mono"', '"MesloLGS NF"',
]

const BUILT_IN_DSH_FONT = '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, "Liberation Mono"'
const WEB_FONT_LOADS = new WeakMap<Document, Promise<void>>()

/**
 * Resolve the xterm font stack from a user preference and the DSH code token.
 * @param custom - User-configured CSS font-family stack.
 * @param host - Element used to resolve the DSH theme token.
 * @returns A font stack with the custom family, DSH theme font, Nerd Font fallbacks, and monospace.
 */
export function resolveTerminalFont(custom: string, host: HTMLElement): string {
  const theme = getComputedStyle(host).getPropertyValue('--ds-font-family-code').trim() || BUILT_IN_DSH_FONT
  const preferred = normalizePreferredFont(custom.trim())
  return [preferred, withoutTrailingGeneric(theme), ...ICON_FONTS, 'monospace'].filter(Boolean).join(', ')
}

export function normalizeTerminalFontFamily(value: string): string {
  const trimmed = value.trim()
  const unquoted = trimmed.replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2')
  return FONT_ALIASES.get(unquoted) ?? trimmed
}

function normalizePreferredFont(value: string): string {
  return normalizeTerminalFontFamily(value)
}

export function getTerminalWebFontFamilies(documentRef: Document | undefined = globalThis.document): string[] {
  const style = documentRef?.querySelector('style[data-dsh-terminal-font]') as HTMLStyleElement | null
  if (style?.sheet === null || style?.sheet === undefined) return []
  const families = new Set<string>()
  for (const rule of style.sheet.cssRules) {
    if (!('style' in rule)) continue
    const family = (rule as CSSFontFaceRule).style.getPropertyValue('font-family').trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2')
    if (family.length > 0) families.add(family)
  }
  return [...families]
}

/**
 * Load the optional same-origin @font-face stylesheet before xterm measures its cells.
 * @param fetcher - Host route fetcher, injectable for tests.
 * @param documentRef - Browser document, injectable for tests.
 */
export function loadTerminalWebFont(
  fetcher: ((input: string) => Promise<{ ok: boolean; text(): Promise<string> }>) | undefined = globalThis.fetch,
  documentRef: Document | undefined = globalThis.document,
): Promise<void> {
  if (fetcher === undefined || documentRef === undefined || documentRef.querySelector('style[data-dsh-terminal-font]') !== null) return Promise.resolve()
  const pending = WEB_FONT_LOADS.get(documentRef)
  if (pending !== undefined) return pending
  const load = (async () => {
    try {
      const response = await fetcher(TERMINAL_FONT_CSS_PATH)
      if (!response.ok || documentRef.querySelector('style[data-dsh-terminal-font]') !== null) return
      const style = documentRef.createElement('style')
      style.dataset.dshTerminalFont = 'true'
      style.textContent = await response.text()
      documentRef.head.append(style)
    } catch {
      // The host route is optional; browsers fall back to installed or generic fonts when absent.
    } finally {
      WEB_FONT_LOADS.delete(documentRef)
    }
  })()
  WEB_FONT_LOADS.set(documentRef, load)
  return load
}

/**
 * Wait for regular and bold terminal faces before xterm measures its cells.
 * @param fontFamily - Resolved CSS font-family stack.
 * @param fontSize - Terminal font size in CSS pixels.
 * @param fonts - Browser font loader; omitted outside a browser document.
 * @param loadWebFont - Optional same-origin stylesheet loader.
 */
export async function loadTerminalFont(
  fontFamily: string,
  fontSize: number,
  fonts = globalThis.document?.fonts,
  loadWebFont = loadTerminalWebFont,
): Promise<void> {
  if (fonts === undefined) return
  await loadWebFont()
  await Promise.all([400, 700].map(async weight => {
    try {
      await fonts.load(`${String(weight)} ${String(fontSize)}px ${fontFamily}`, TERMINAL_FONT_SAMPLE)
    } catch {
      // A malformed custom family must not prevent the terminal from opening with its fallback stack.
    }
  }))
}

function withoutTrailingGeneric(stack: string): string {
  return stack.replace(/,?\s*(ui-)?monospace\s*$/i, '')
}
