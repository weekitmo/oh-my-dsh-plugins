// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { colorizeFavicon, FaviconNotifier } from '../src/client/favicon.ts'

const HOST_ICON = '<svg><style>path { fill: #fff; }</style><path fill="#000"/></svg>'

describe('idle favicon surface', () => {
  beforeEach(() => { document.head.replaceChildren() })

  it('recolors both light and dark host favicon marks', () => {
    const result = colorizeFavicon(HOST_ICON)
    expect(result).not.toMatch(/#(?:000|fff)(?:[;"])/i)
    expect(result.match(/#3964fe/g)).toHaveLength(2)
  })

  it('adds a blue override while active and restores the host icon', async () => {
    const host = document.createElement('link')
    host.rel = 'icon'
    host.href = '/favicon.svg'
    document.head.append(host)
    const notifier = new FaviconNotifier(document, async () => HOST_ICON)
    notifier.render(true)
    await Promise.resolve()
    const override = document.querySelector<HTMLLinkElement>('link[data-dsh-notify-favicon]')
    expect(override?.href).toContain('%233964fe')
    notifier.render(false)
    expect(document.querySelector('link[data-dsh-notify-favicon]')).toBeNull()
    expect(host.isConnected).toBe(true)
  })

  it('deduplicates repeated renders while the favicon is loading', () => {
    const host = document.createElement('link')
    host.rel = 'icon'
    document.head.append(host)
    let calls = 0
    const notifier = new FaviconNotifier(document, () => { calls += 1; return new Promise(() => {}) })
    notifier.render(true)
    notifier.render(true)
    expect(calls).toBe(1)
  })

  it('aborts a pending override when the page becomes visible', async () => {
    const host = document.createElement('link')
    host.rel = 'icon'
    document.head.append(host)
    let signal: AbortSignal | undefined
    let resolve: ((value: string) => void) | undefined
    const notifier = new FaviconNotifier(document, (_href, nextSignal) => {
      signal = nextSignal
      return new Promise(value => { resolve = value })
    })
    notifier.render(true)
    notifier.render(false)
    expect(signal?.aborted).toBe(true)
    resolve?.(HOST_ICON)
    await Promise.resolve()
    expect(document.querySelector('link[data-dsh-notify-favicon]')).toBeNull()
  })
})
