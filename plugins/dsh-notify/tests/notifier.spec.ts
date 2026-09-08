// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createNotification, notificationBody, NotificationRegistry, notificationTitleKey, shouldShowSystem } from '../src/client/notifier.ts'
import { defaultNotificationSettings } from '../src/client/state.ts'

describe('system notification helpers', () => {
  it('maps every outcome title', () => {
    expect(notificationTitleKey('completed')).toBe('notify.completed')
    expect(notificationTitleKey('error')).toBe('notify.error')
    expect(notificationTitleKey('aborted')).toBe('notify.aborted')
    expect(notificationTitleKey('blocked')).toBe('notify.blocked')
    expect(notificationTitleKey('max-tokens')).toBe('notify.maxTokens')
  })

  it('contains browser notification construction failures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const BrokenNotification = class {
      constructor() { throw new Error('blocked by platform') }
    }
    expect(createNotification(BrokenNotification as never, 'Title', {})).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[dsh-notify] browser notification could not be created', expect.any(Error))
  })

  it('requires permission and honors the background-only setting', () => {
    const settings = defaultNotificationSettings()
    expect(shouldShowSystem('denied', settings, true, 'a', 'b')).toBe(false)
    expect(shouldShowSystem('granted', settings, false, 'a', 'a')).toBe(true)
    expect(shouldShowSystem('granted', { ...settings, backgroundOnly: true }, false, 'a', 'a')).toBe(false)
    expect(shouldShowSystem('granted', { ...settings, backgroundOnly: true }, false, 'a', 'b')).toBe(true)
  })

  it('closes tracked notifications on plugin disposal', () => {
    const registry = new NotificationRegistry()
    const closed: string[] = []
    const first = { onclick: () => {}, onclose: null, close: () => { closed.push('first') } }
    const second = { onclick: () => {}, onclose: null, close: () => { closed.push('second') } }
    registry.track(first as never)
    registry.track(second as never)
    first.onclose?.call(undefined as never, new Event('close'))
    registry.closeAll()
    expect(second.onclick).toBeNull()
    expect(second.onclose).toBeNull()
    expect(closed).toEqual(['second'])
  })

  it('prefixes the notification body with its session title', () => {
    const value = { sessionId: 'a', turn: 1, reason: 'error', tone: 'error', title: 'Deploy', body: ' boom ', createdAt: 1 } as const
    expect(notificationBody(value, 'ended', 100)).toBe('Deploy: boom')
    expect(notificationBody({ ...value, body: '' }, 'ended', 100)).toBe('Deploy: ended')
    expect(notificationBody({ ...value, body: 'abcdefgh' }, 'ended', 5)).toBe('Deploy: abcd…')
  })
})
