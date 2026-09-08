import { describe, expect, it } from 'vitest'
import type { AttentionEntry } from '../src/contract.ts'
import { attentionEntries, clearAttention, defaultNotificationSettings, filterAttentionBySettings, normalizeNotificationSettings, putAttention, retainAttention, runningConversationCount, type AttentionState } from '../src/client/state.ts'

function entry(sessionId: string, createdAt: number): AttentionEntry {
  return { sessionId, turn: 1, reason: 'completed', tone: 'success', title: sessionId, body: '', createdAt }
}

describe('notification state', () => {
  it('enables all requested surfaces and outcomes by default', () => {
    expect(defaultNotificationSettings()).toEqual({
      enabled: true,
      systemNotifications: true,
      titleNotifications: true,
      runningTitleIndicator: true,
      idleTitleAnimation: true,
      idleFaviconIndicator: false,
      sidebarIndicators: true,
      titleAnimation: 'marquee',
      maxBodyChars: 400,
      backgroundOnly: false,
      notifyCompleted: true,
      notifyError: true,
      notifyAborted: true,
      notifyBlocked: true,
      notifyMaxTokens: true,
    })
  })

  it('fills missing persisted settings fields from current defaults', () => {
    const normalized = normalizeNotificationSettings({ enabled: false, notifyError: false })
    expect(normalized.enabled).toBe(false)
    expect(normalized.notifyError).toBe(false)
    expect(normalized.runningTitleIndicator).toBe(true)
    expect(normalized.idleTitleAnimation).toBe(true)
    expect(normalized.idleFaviconIndicator).toBe(false)
    expect(normalized.notifyBlocked).toBe(true)
    expect(normalized.maxBodyChars).toBe(400)
    expect(normalizeNotificationSettings({ maxBodyChars: 99 }).maxBodyChars).toBe(400)
    expect(normalizeNotificationSettings({ maxBodyChars: 2001 }).maxBodyChars).toBe(400)
    expect(normalizeNotificationSettings({ maxBodyChars: 1200 }).maxBodyChars).toBe(1200)
    expect(normalizeNotificationSettings('{bad' as unknown)).toEqual(defaultNotificationSettings())
  })

  it('clears unread results when the master or outcome switch disables them', () => {
    const state: AttentionState = { bySession: { a: entry('a', 1), b: { ...entry('b', 2), reason: 'error', tone: 'error' } } }
    expect(Object.keys(filterAttentionBySettings(state, { ...defaultNotificationSettings(), enabled: false }).bySession)).toHaveLength(0)
    expect(Object.keys(filterAttentionBySettings(state, { ...defaultNotificationSettings(), notifyCompleted: false }).bySession)).toEqual(['b'])
  })

  it('keeps one unread result per session and clears viewed or removed sessions', () => {
    let state: AttentionState = { bySession: {} }
    state = putAttention(state, entry('later', 20))
    state = putAttention(state, entry('earlier', 10))
    state = putAttention(state, { ...entry('later', 30), reason: 'error', tone: 'error' })
    expect(attentionEntries(state).map(item => [item.sessionId, item.reason]))
      .toEqual([['earlier', 'completed'], ['later', 'error']])
    state = clearAttention(state, 'earlier')
    state = retainAttention(state, new Set(['later']))
    expect(Object.keys(state.bySession)).toEqual(['later'])
    state = retainAttention(state, new Set())
    expect(state.bySession).toEqual({})
  })

  it('folds running subagents into their visible parent for the title spinner count', () => {
    const byId = {
      parent: { id: 'parent', running: true },
      child: { id: 'child', parentId: 'parent', origin: 'subagent' as const, running: true },
      background: { id: 'background', parentId: 'idle-parent', origin: 'subagent' as const, running: true },
      'idle-parent': { id: 'idle-parent', running: false },
      fork: { id: 'fork', parentId: 'parent', running: true },
    }
    expect(runningConversationCount(Object.keys(byId), byId)).toBe(3)
  })
})
