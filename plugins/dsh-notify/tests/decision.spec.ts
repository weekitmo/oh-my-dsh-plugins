// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { asReason, reasonEnabled, toneOf } from '../src/client/decision.ts'
import { defaultNotificationSettings } from '../src/client/state.ts'

describe('notification decisions', () => {
  it.each(['completed', 'error', 'aborted', 'blocked', 'max-tokens'] as const)('accepts %s', reason => {
    expect(asReason(reason)).toBe(reason)
    expect(reasonEnabled(defaultNotificationSettings(), reason)).toBe(true)
  })

  it('rejects unknown reasons and colors only successful completion green', () => {
    expect(asReason('unknown')).toBeUndefined()
    expect(asReason('interrupted')).toBe('aborted')
    expect(toneOf('completed')).toBe('success')
    expect(toneOf('error')).toBe('error')
    expect(toneOf('aborted')).toBe('error')
    expect(toneOf('blocked')).toBe('error')
    expect(toneOf('max-tokens')).toBe('error')
  })

  it('treats the client-raised approval reason separately from host projections', () => {
    // `approval` never comes from a turn/end projection; it is raised by the
    // forwarded approval waterfall, so asReason must keep ignoring it.
    expect(asReason('approval')).toBeUndefined()
    expect(toneOf('approval')).toBe('attention')
    expect(reasonEnabled(defaultNotificationSettings(), 'approval')).toBe(true)
    expect(reasonEnabled({ ...defaultNotificationSettings(), notifyApproval: false }, 'approval')).toBe(false)
  })
})
