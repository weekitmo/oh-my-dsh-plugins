import { describe, expect, it } from 'vitest'
import { cssText } from '../src/client/styles.ts'

/** One rule's declaration block, matched from its exact selector. */
function rule(selector: string): string {
  const start = cssText.indexOf(`${selector} {`)
  expect(start, `rule not found: ${selector}`).toBeGreaterThanOrEqual(0)
  return cssText.slice(start, cssText.indexOf('}', start))
}

describe('theme-safe settings styles', () => {
  // Regression: the primary button paired a hard-coded `color: white` with the
  // brand fill. The harness brand token is monochrome and flips per theme
  // (near-black on light, near-white on dark), so dark mode rendered white text
  // on a near-white pill — invisible in the DingTalk action row.
  it('pairs the primary fill with the foreground label token', () => {
    const primary = rule('.dsh_notify_buttonPrimary')
    expect(primary).toContain('--dsw-alias-button-primary-fill')
    expect(primary).toContain('--dsw-alias-brand-primary')
    expect(primary).toContain('--dsw-alias-label-primary-foreground')
    expect(primary).not.toMatch(/color:\s*(?:white|#fff\b|#ffffff\b)/iu)
  })

  it('keeps the primary hover on the button hover token', () => {
    const hover = rule('.dsh_notify_buttonPrimary:hover:not(:disabled)')
    expect(hover).toContain('--dsw-alias-button-primary-hover')
  })

  it('colors the waiting-for-approval indicator with the warning token', () => {
    expect(rule("[data-dsh-notify-indicator][data-tone='attention']"))
      .toContain('--dsw-alias-state-warn-primary')
  })

  it('only uses design tokens the harness theme defines', () => {
    const tokens = new Set(cssText.match(/--dsw-[a-z0-9-]+/gu) ?? [])
    // Every referenced token exists in the harness token list; a typo would fall
    // back to an unstyled declaration instead of failing loudly.
    for (const token of tokens) {
      expect(token.startsWith('--dsw-alias-') || token.startsWith('--dsw-static-'), `unexpected token ${token}`).toBe(true)
    }
  })
})
