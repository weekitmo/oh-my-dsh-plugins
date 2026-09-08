/** Terminal font resolution and browser loading for Nerd Font glyphs. */
const DEFAULT_TERMINAL_FONT = '"Maple Mono NF CN"'
const TERMINAL_FONT_SAMPLE = `M\ue0a0\ue0b0\uf101\uf120`

const ICON_FONTS = [
  '"Symbols Nerd Font Mono"', '"Symbols Nerd Font"',
  '"Hack Nerd Font Mono"', '"JetBrainsMono Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"', '"CaskaydiaCove Nerd Font Mono"',
  '"SauceCodePro Nerd Font Mono"', '"UbuntuMono Nerd Font Mono"',
  '"Iosevka Nerd Font Mono"', '"IosevkaTerm Nerd Font Mono"',
  '"MesloLGS Nerd Font Mono"', '"MesloLGS NF"',
]

const BUILT_IN_DSH_FONT = '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, "Liberation Mono"'

/**
 * Resolve the xterm font stack from a user preference and the DSH code token.
 * @param custom - User-configured CSS font-family stack.
 * @param host - Element used to resolve the DSH theme token.
 * @returns A font stack with the custom family, Maple Mono, DSH, and Nerd Font fallbacks.
 */
export function resolveTerminalFont(custom: string, host: HTMLElement): string {
  const theme = getComputedStyle(host).getPropertyValue('--ds-font-family-code').trim() || BUILT_IN_DSH_FONT
  const preferred = custom.trim()
  return [preferred, DEFAULT_TERMINAL_FONT, withoutTrailingGeneric(theme), ...ICON_FONTS, 'monospace'].filter(Boolean).join(', ')
}

/**
 * Wait for regular and bold terminal faces before xterm measures its cells.
 * @param fontFamily - Resolved CSS font-family stack.
 * @param fontSize - Terminal font size in CSS pixels.
 * @param fonts - Browser font loader; omitted outside a browser document.
 */
export async function loadTerminalFont(fontFamily: string, fontSize: number, fonts = globalThis.document?.fonts): Promise<void> {
  if (fonts === undefined) return
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
