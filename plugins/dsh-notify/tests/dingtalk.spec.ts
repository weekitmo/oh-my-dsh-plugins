import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DingTalkNotification, DingTalkSettingsUpdate } from '../src/contract.ts'
import { dingTalkSign, DingTalkService, formatMissedDigest, isQuietAt, millisecondsUntilQuietEnd, normalizeDingTalkSettings, trustedDingTalkRequest, createDingTalkRoute } from '../src/dingtalk.ts'

const direct: DingTalkSettingsUpdate = {
  accessToken: 'token',
  signingSecret: 'SEC-secret',
  notifyCompleted: true,
  notifyFailed: true,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
  notifyMissed: true,
}

function message(eventId: string, reason: DingTalkNotification['reason'] = 'completed'): DingTalkNotification {
  return { eventId, sessionId: 'session-a', turn: Number(eventId.replace(/\D/g, '')) || 1, reason, title: 'Deploy', body: 'Result body' }
}

function successFetch(records: Array<{ url: URL; body: unknown }>): typeof fetch {
  return vi.fn(async (input, init) => {
    records.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body)) as unknown })
    return new Response('{"errcode":0,"errmsg":"ok"}', { status: 200 })
  }) as typeof fetch
}

describe('DingTalk host service', () => {
  it('uses the documented HMAC-SHA256 signature', () => {
    expect(dingTalkSign('SEC-secret', 1_722_614_400_000)).toBe('xFv37Zo3R6xgUlcgmRUNFuGQhyFF1nJVWv0r+QUydiA=')
  })

  it('validates paired credentials and strict quiet-hour clocks', () => {
    expect(normalizeDingTalkSettings({})).toMatchObject({ quietHoursStart: '23:00', notifyMissed: false })
    expect(() => normalizeDingTalkSettings({ accessToken: 'token' })).toThrow(/configured together/)
    expect(() => normalizeDingTalkSettings({ quietHoursStart: '8:00' })).toThrow(/HH:MM/)
    expect(() => normalizeDingTalkSettings({ quietHoursStart: '08:00', quietHoursEnd: '08:00' })).toThrow(/different/)
  })

  it('supports same-day and cross-midnight Shanghai windows', () => {
    const at = (iso: string): Date => new Date(iso)
    expect(isQuietAt(at('2026-08-13T15:00:00Z'), '23:00', '08:00')).toBe(true)
    expect(isQuietAt(at('2026-08-13T23:59:00Z'), '23:00', '08:00')).toBe(true)
    expect(isQuietAt(at('2026-08-14T00:00:00Z'), '23:00', '08:00')).toBe(false)
    expect(isQuietAt(at('2026-08-13T04:00:00Z'), '12:00', '14:00')).toBe(true)
    expect(isQuietAt(at('2026-08-13T06:00:00Z'), '12:00', '14:00')).toBe(false)
    expect(millisecondsUntilQuietEnd(at('2026-08-13T15:00:00Z'), '23:00', '08:00')).toBe(9 * 60 * 60 * 1000)
  })

  it('accepts only local same-origin API requests', () => {
    const request = (headers: Record<string, string>, remoteAddress: string, method = 'GET') => ({
      headers,
      method,
      socket: { remoteAddress },
    }) as never
    expect(trustedDingTalkRequest(request({ host: '127.0.0.1:3080' }, '127.0.0.1'))).toBe(true)
    expect(trustedDingTalkRequest(request({
      host: 'localhost:3080',
      origin: 'http://localhost:3080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json; charset=utf-8',
    }, '::1', 'PUT'))).toBe(true)
    expect(trustedDingTalkRequest(request({ host: '127.0.0.1:3080' }, '192.168.1.8'))).toBe(false)
    expect(trustedDingTalkRequest(request({ host: 'evil.example:3080' }, '127.0.0.1'))).toBe(false)
    expect(trustedDingTalkRequest(request({
      host: '127.0.0.1:3080',
      origin: 'http://evil.example',
      'content-type': 'application/json',
    }, '127.0.0.1', 'POST'))).toBe(false)
    expect(trustedDingTalkRequest(request({
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    }, '127.0.0.1', 'POST'))).toBe(false)
    expect(trustedDingTalkRequest(request({
      host: '127.0.0.1:3080',
      'content-type': 'application/json',
    }, '127.0.0.1', 'POST'))).toBe(false)
    expect(trustedDingTalkRequest(request({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain',
    }, '127.0.0.1', 'POST'))).toBe(false)
  })

  it('enforces request trust at the real HTTP route', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-route-' + Math.random().toString(16).slice(2))
    const service = new DingTalkService({ root, fetch: successFetch([]) })
    const server = createServer((req, res) => { void createDingTalkRoute(service)(req, res) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected TCP address')
    const url = 'http://127.0.0.1:' + address.port + '/api/dsh-notify/dingtalk'
    const body = JSON.stringify(direct)
    const denied = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
    expect(denied.status).toBe(403)
    const allowed = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:' + address.port,
        'sec-fetch-site': 'same-origin',
      },
      body,
    })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ configured: true })
    service.dispose()
    server.close()
    await once(server, 'close')
  })

  it('sends selected outcomes once with signed query parameters', async () => {
    const records: Array<{ url: URL; body: unknown }> = []
    const now = new Date('2026-08-13T12:00:00Z')
    const service = new DingTalkService({ root: join(process.env.TMPDIR ?? '/tmp', 'unused'), now: () => now, fetch: successFetch(records) })
    await service.updateSettings({ ...direct, notifyCompleted: false })
    expect(await service.notify(message('event-1', 'completed'))).toBe('ignored')
    expect(await service.notify(message('event-2', 'error'))).toBe('sent')
    expect(await service.notify(message('event-2', 'error'))).toBe('duplicate')
    expect(records).toHaveLength(1)
    expect(records[0]!.url.searchParams.get('access_token')).toBe('token')
    expect(records[0]!.url.searchParams.get('timestamp')).toBe(String(now.getTime()))
    expect(records[0]!.url.searchParams.get('sign')).toBe(dingTalkSign('SEC-secret', now.getTime()))
    expect(records[0]!.body).toMatchObject({ msgtype: 'markdown', markdown: { title: 'DSH 任务失败' } })
    service.dispose()
  })

  it('retries a failed direct notification after restart', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-test-' + Math.random().toString(16).slice(2))
    let persistedBeforeRequest = false
    const failed = vi.fn<typeof fetch>().mockImplementation(async () => {
      const pending = JSON.parse(await readFile(join(root, 'dingtalk-missed.json'), 'utf8')) as { messages: unknown[] }
      persistedBeforeRequest = pending.messages.length === 1
      return new Response('{"errcode":-1,"errmsg":"system busy"}')
    })
    const first = new DingTalkService({ root, fetch: failed })
    await first.updateSettings(direct)
    await expect(first.notify(message('event-1'))).rejects.toThrow(/system busy/)
    expect(persistedBeforeRequest).toBe(true)
    const pending = JSON.parse(await readFile(join(root, 'dingtalk-missed.json'), 'utf8')) as {
      digest: boolean
      messages: DingTalkNotification[]
    }
    expect(pending).toMatchObject({ digest: false })
    expect(pending.messages.map(item => item.eventId)).toEqual(['event-1'])
    first.dispose()

    const records: Array<{ url: URL; body: unknown }> = []
    const retry = new DingTalkService({ root, fetch: successFetch(records) })
    await retry.initialize()
    await vi.waitFor(() => { expect(records).toHaveLength(1) })
    expect(records[0]!.body).toMatchObject({ markdown: { title: 'DSH 任务已完成' } })
    await vi.waitFor(async () => {
      await expect(readFile(join(root, 'dingtalk-missed.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
    retry.dispose()
  })

  it('persists quiet messages privately and sends one digest after restart', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-test-' + Math.random().toString(16).slice(2))
    let now = new Date('2026-08-13T15:30:00Z')
    const records: Array<{ url: URL; body: unknown }> = []
    const first = new DingTalkService({ root, now: () => now, fetch: successFetch(records) })
    await first.updateSettings({ ...direct, quietHoursEnabled: true })
    expect(await first.notify(message('event-1'))).toBe('queued')
    expect(await first.notify(message('event-2', 'blocked'))).toBe('queued')
    expect(records).toHaveLength(0)
    const queuePath = join(root, 'dingtalk-missed.json')
    expect((await stat(queuePath)).mode & 0o077).toBe(0)
    first.dispose()

    now = new Date('2026-08-14T00:00:00Z')
    const second = new DingTalkService({ root, now: () => now, fetch: successFetch(records) })
    await second.initialize()
    await second.sendTest()
    await vi.waitFor(() => { expect(records.length).toBeGreaterThanOrEqual(2) })
    const markdown = records.map(record => (record.body as { markdown: { title: string; text: string } }).markdown)
    const digest = markdown.find(item => item.title === '免打扰期间消息汇总')
    expect(digest?.text).toContain('共记录 **2** 条消息')
    expect(digest?.text).toContain('Deploy')
    second.dispose()
  })

  it('retains old and current results when a post-quiet digest fails', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-test-' + Math.random().toString(16).slice(2))
    let now = new Date('2026-08-13T15:30:00Z')
    const responses = [
      new Response('{"errcode":310000,"errmsg":"temporary failure"}'),
      new Response('{"errcode":0,"errmsg":"ok"}'),
    ]
    const request = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!)
    const service = new DingTalkService({ root, now: () => now, fetch: request })
    await service.updateSettings({ ...direct, quietHoursEnabled: true })
    await service.notify(message('event-1'))

    now = new Date('2026-08-14T00:00:00Z')
    await expect(service.notify({ ...message('event-2', 'error'), body: 'current result' }))
      .rejects.toThrow(/temporary failure/)
    const persisted = JSON.parse(await readFile(join(root, 'dingtalk-missed.json'), 'utf8')) as { messages: DingTalkNotification[] }
    expect(persisted.messages.map(item => item.eventId)).toEqual(['event-1', 'event-2'])

    service.dispose()
    const retry = new DingTalkService({ root, now: () => now, fetch: request })
    await retry.initialize()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    await vi.waitFor(async () => {
      await expect(readFile(join(root, 'dingtalk-missed.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
    retry.dispose()
  })

  it('clears queued data before rotating robot credentials', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-rotation-' + Math.random().toString(16).slice(2))
    const now = new Date('2026-08-13T15:30:00Z')
    const service = new DingTalkService({ root, now: () => now, fetch: successFetch([]) })
    await service.updateSettings({ ...direct, quietHoursEnabled: true })
    await service.notify(message('event-1'))
    expect(await readFile(join(root, 'dingtalk-missed.json'), 'utf8')).toContain('event-1')
    await service.updateSettings({ ...direct, accessToken: 'new-token', signingSecret: 'new-secret', quietHoursEnabled: true })
    await expect(readFile(join(root, 'dingtalk-missed.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const saved = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8')) as { accessToken: string }
    expect(saved.accessToken).toBe('new-token')
    service.dispose()
  })

  it('removes queued outcomes when their category is disabled', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-filter-' + Math.random().toString(16).slice(2))
    const now = new Date('2026-08-13T15:30:00Z')
    const service = new DingTalkService({ root, now: () => now, fetch: successFetch([]) })
    await service.updateSettings({ ...direct, quietHoursEnabled: true })
    await service.notify(message('event-1', 'completed'))
    await service.notify(message('event-2', 'error'))
    await service.updateSettings({ ...direct, quietHoursEnabled: true, notifyCompleted: false })
    const filtered = JSON.parse(await readFile(join(root, 'dingtalk-missed.json'), 'utf8')) as { messages: DingTalkNotification[] }
    expect(filtered.messages.map(item => item.eventId)).toEqual(['event-2'])
    await service.updateSettings({ ...direct, quietHoursEnabled: true, notifyCompleted: false, notifyFailed: false })
    await expect(readFile(join(root, 'dingtalk-missed.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    service.dispose()
  })

  it('does not enforce POSIX mode bits on Windows', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-win32-' + Math.random().toString(16).slice(2))
    const service = new DingTalkService({ root, platform: 'win32', fetch: successFetch([]) })
    await service.updateSettings(direct)
    await chmod(join(root, 'settings.json'), 0o644)
    await expect(new DingTalkService({ root, platform: 'win32' }).initialize()).resolves.toBeUndefined()
    service.dispose()
  })

  it('never exposes credentials and keeps existing credentials when inputs are blank', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-test-' + Math.random().toString(16).slice(2))
    const service = new DingTalkService({ root, fetch: successFetch([]) })
    expect(await service.updateSettings(direct)).toMatchObject({ configured: true })
    expect(service.getSettings()).not.toHaveProperty('accessToken')
    expect(await service.updateSettings({ ...direct, accessToken: undefined, signingSecret: undefined, notifyFailed: false })).toMatchObject({ configured: true, notifyFailed: false })
    const saved = await readFile(join(root, 'settings.json'), 'utf8')
    expect(saved).toContain('SEC-secret')
    await chmod(join(root, 'settings.json'), 0o644)
    const unsafe = new DingTalkService({ root })
    await expect(unsafe.initialize()).rejects.toThrow(/permissions 0600/)
    service.dispose()
  })

  it('rejects malformed or oversized durable missed-message queues', async () => {
    const root = join(process.env.TMPDIR ?? '/tmp', 'dsh-notify-test-' + Math.random().toString(16).slice(2))
    const settings = new DingTalkService({ root })
    await settings.updateSettings(direct)
    const queuePath = join(root, 'dingtalk-missed.json')
    await writeFile(queuePath, JSON.stringify({ messages: [], omitted: -1 }), { mode: 0o600 })
    await expect(new DingTalkService({ root }).initialize()).rejects.toThrow(/cannot be negative/)
    await writeFile(queuePath, JSON.stringify({ messages: Array.from({ length: 201 }, (_, index) => ({
      ...message('event-' + index),
      capturedAt: '2026-08-13T15:30:00.000Z',
    })), omitted: 0 }), { mode: 0o600 })
    await expect(new DingTalkService({ root }).initialize()).rejects.toThrow(/exceeds 200/)
    settings.dispose()
  })

  it('formats a bounded missed-message digest', () => {
    const digest = formatMissedDigest({
      messages: [{ ...message('event-1'), body: '🙂'.repeat(800), capturedAt: '2026-08-13T15:30:00Z' }],
      omitted: 2,
      digest: true,
    }, new Date('2026-08-14T00:00:00Z'))
    expect(digest.title).toBe('免打扰期间消息汇总')
    expect(digest.text).toContain('共记录 **3** 条消息')
    expect(digest.text).toContain('内容已截断')
  })
})
