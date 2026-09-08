import { describe, expect, it } from 'vitest'
import type { AttentionEntry } from '../src/contract.ts'
import { aggregatedTitle, productTitleOf, recentWorkspaceSessionTitle, shellTitleOf, TitleNotifier } from '../src/client/title.ts'

function entry(sessionId: string, reason: AttentionEntry['reason'], createdAt: number): AttentionEntry {
  return { sessionId, turn: 1, reason, tone: reason === 'completed' ? 'success' : 'error', title: sessionId, body: '', createdAt }
}

describe('aggregatedTitle', () => {
  it('folds multiple sessions by outcome and includes running sessions', () => {
    const text = aggregatedTitle(
      [entry('a', 'completed', 1), entry('b', 'completed', 2), entry('c', 'error', 3)],
      (reason, count) => `${String(count)} ${reason}`,
      2,
      count => `${String(count)} running`,
    )
    expect(text).toBe('dsh (2 running · 2 completed · 1 error)')
  })
})

describe('recentWorkspaceSessionTitle', () => {
  it('selects the most recently updated durable workspace session', () => {
    const byId = {
      older: { displayTitle: 'Older', title: ' Older title ', cwd: '/project', blank: false, updatedAt: 10 },
      newer: { displayTitle: 'Newer fallback', cwd: '/project', blank: false, updatedAt: 20 },
      loose: { displayTitle: 'Loose', blank: false, updatedAt: 40 },
      blank: { displayTitle: 'Blank', cwd: '/project', blank: true, updatedAt: 50 },
      child: { displayTitle: 'Child', cwd: '/project', origin: 'subagent' as const, blank: false, updatedAt: 60 },
    }
    expect(recentWorkspaceSessionTitle(Object.keys(byId), byId)).toBe('Newer fallback')
    expect(recentWorkspaceSessionTitle(['loose', 'blank', 'child'], byId)).toBeUndefined()
  })
})

describe('TitleNotifier', () => {
  it('uses requestAnimationFrame while the page is visible', () => {
    const target = { title: 'DeepSeek Harness' }
    let frame: FrameRequestCallback | undefined
    let fallbackScheduled = false
    const notifier = new TitleNotifier(
      target,
      () => { fallbackScheduled = true; return 1 },
      () => {},
      callback => { frame = callback; return 2 },
      () => {},
      () => false,
      () => 0,
    )
    notifier.render('dsh (1 completed)', 'marquee', false, true)
    expect(fallbackScheduled).toBe(false)
    expect(frame).toBeDefined()
    frame?.(1000)
    expect(target.title).not.toBe('dsh (1 completed)')
    notifier.dispose()
  })

  it('renders a stable workspace title without scheduling animation', () => {
    const target = { title: 'DeepSeek Harness' }
    let scheduled = false
    const notifier = new TitleNotifier(target, () => { scheduled = true; return 1 }, () => {})
    notifier.render('Recent workspace — DeepSeek Harness', 'marquee', false, false)
    expect(target.title).toBe('Recent workspace — DeepSeek Harness')
    expect(scheduled).toBe(false)
    notifier.dispose('Selected session — DeepSeek Harness')
    expect(target.title).toBe('Selected session — DeepSeek Harness')
  })

  it('cancels idle animation when returning to a static title', () => {
    const target = { title: 'DeepSeek Harness' }
    let cancelled: number | undefined
    const notifier = new TitleNotifier(target, () => 11, id => { cancelled = id })
    notifier.render('Recent workspace — DeepSeek Harness', 'marquee', false, true, 'DeepSeek Harness')
    notifier.render('', 'marquee', false, false, 'Recent workspace — DeepSeek Harness')
    expect(cancelled).toBe(11)
    expect(target.title).toBe('Recent workspace — DeepSeek Harness')
  })

  it('animates a unicode spinner and restores the original title', () => {
    const target = { title: 'DeepSeek Harness' }
    let callback: (() => void) | undefined
    let cancelled = false
    const notifier = new TitleNotifier(
      target,
      next => { callback = next; return 7 },
      id => { cancelled = id === 7 },
    )
    notifier.render('dsh (1 running)', 'marquee', true, false)
    expect(target.title).toContain('⠋')
    expect(target.title).toContain('1 running')
    callback?.()
    expect(target.title).toContain('⠙')
    notifier.render('dsh (1 completed)', 'blink', false, true, 'Selected session — DeepSeek Harness')
    notifier.dispose()
    expect(cancelled).toBe(true)
    expect(target.title).toBe('Selected session — DeepSeek Harness')
  })

  it('derives and restores the shell title from the durable session title', () => {
    expect(productTitleOf('Selected — DeepSeek Harness', 'Selected')).toBe('DeepSeek Harness')
    expect(productTitleOf('DeepSeek Harness', 'Selected')).toBe('DeepSeek Harness')
    expect(shellTitleOf('DeepSeek Harness', 'Selected')).toBe('Selected — DeepSeek Harness')
    expect(shellTitleOf('DeepSeek Harness', undefined)).toBe('DeepSeek Harness')
  })
})
