// @vitest-environment jsdom
/**
 * End-to-end client composition: mounts the real client plugin against fake
 * client services and drives the two notification triggers the browser uses —
 * a settled turn from the session-list projection, and a forwarded
 * `approval/request` waterfall event. Covers the regression where the runner's
 * convergence timer never fired (bare `setTimeout` called as a method throws
 * `TypeError: Illegal invocation` in a browser), so no result ever surfaced.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationSettings } from '../src/contract.ts'
import * as plugin from '../src/client/index.ts'
import { defaultNotificationSettings } from '../src/client/state.ts'
import { SOUND_SOURCES } from '../src/client/sounds.ts'
import { zh } from '../src/client/locales.ts'

interface SessionSummaryLike {
  readonly id: string
  readonly displayTitle: string
  readonly running: boolean
  readonly completed?: boolean
  readonly blank?: boolean
  readonly updatedAt: number
  readonly projectionValues?: { readonly dshNotify?: unknown }
}

interface ListStateLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly current: string | undefined
  readonly phase: string
  readonly jobsBySession: Readonly<Record<string, readonly { readonly id: string; readonly status: string }[]>>
  readonly subagentsByParent: Readonly<Record<string, unknown>>
  readonly currentAddress: undefined
}

function listState(options: {
  readonly turn?: number
  readonly reason?: string
  readonly running?: boolean
  readonly completed?: boolean
  readonly current?: string
} = {}): ListStateLike {
  const turn = options.turn ?? 0
  return {
    ids: ['s1'],
    byId: {
      s1: {
        id: 's1',
        displayTitle: 'Notify session',
        running: options.running ?? false,
        ...(options.completed === true ? { completed: true } : {}),
        blank: false,
        updatedAt: 1,
        projectionValues: {
          dshNotify: {
            turn,
            reason: turn === 0 ? '' : options.reason ?? 'completed',
            body: 'finished body',
            startedAsyncDelegation: false,
          },
        },
      },
    },
    current: options.current ?? 's1',
    phase: 'ready',
    jobsBySession: {},
    subagentsByParent: {},
    currentAddress: undefined,
  }
}

class TestListStore {
  private snapshot: unknown = listState()
  private readonly listeners = new Set<() => void>()

  getSnapshot(): unknown { return this.snapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(next: unknown): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

class TestLocale extends Service {
  private readonly dictionaries = new Map<string, Record<string, string>>()

  constructor(ctx: Context) { super(ctx, 'locale') }

  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void {
    this.dictionaries.set(namespace, dictionaries.zh ?? {})
    return () => { this.dictionaries.delete(namespace) }
  }

  bind(namespace: string): (key: string, params?: Record<string, string | number>) => string {
    return (key, params) => {
      const template = this.dictionaries.get(namespace)?.[key] ?? key
      return template.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
    }
  }
}

class TestSlots extends Service {
  constructor(ctx: Context) { super(ctx, 'slots') }
  inject(_name: string, _factory: () => unknown): void {}
  register(): () => void { return () => {} }
}

class TestSessions extends Service {
  readonly list = new TestListStore()
  readonly opened: string[] = []

  constructor(ctx: Context) { super(ctx, 'sessions') }

  open(id: string): void { this.opened.push(id) }

  scopeOf(): string { return 's1' }
}

type ApprovalListener = (request: { readonly toolName: string; readonly reason?: string }, next: () => Promise<unknown>) => Promise<unknown>

class TestRemote extends Service {
  approval: ApprovalListener | undefined

  constructor(ctx: Context) { super(ctx, 'remote') }

  $on(event: string, listener: ApprovalListener): () => void {
    if (event === 'approval/request') this.approval = listener
    return () => { if (event === 'approval/request') this.approval = undefined }
  }
}

interface AudioStub {
  readonly source: string
  volume: number
  currentTime: number
  readonly played: number
}

let audio: AudioStub[] = []
let notifications: { readonly title: string; readonly body?: string }[] = []

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission(): Promise<NotificationPermission> { return Promise.resolve('granted') }

  readonly title: string
  readonly options: NotificationOptions | undefined
  onclick: unknown = null
  onclose: unknown = null

  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options
    notifications.push({ title, ...(options?.body === undefined ? {} : { body: options.body }) })
  }

  close(): void {}
}

class FakeAudio implements AudioStub {
  readonly source: string
  volume = 1
  currentTime = 0
  played = 0

  constructor(source: string) {
    this.source = source
    audio.push(this)
  }

  play(): Promise<void> {
    ;(this as unknown as { played: number }).played += 1
    return Promise.resolve()
  }
}

function persistedSettings(patch: Partial<NotificationSettings>): void {
  window.localStorage.setItem('dsh-notify.v1', JSON.stringify({ ...defaultNotificationSettings(), ...patch }))
}

async function mount(): Promise<{
  ctx: Context
  sessions: TestSessions
  remote: TestRemote
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(TestLocale)
  await ctx.plugin(TestSlots)
  await ctx.plugin(TestSessions)
  await ctx.plugin(TestRemote)
  const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
  await fiber
  return {
    ctx,
    sessions: ctx.get('sessions') as unknown as TestSessions,
    remote: ctx.get('remote') as unknown as TestRemote,
    dispose: async () => { await fiber.dispose() },
  }
}

beforeEach(() => {
  audio = []
  notifications = []
  window.localStorage.clear()
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.title = ''
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-dsh-notify-sidebar')
})

describe('client composition: settled turn', () => {
  it('surfaces a completion through the system notification, sound, and title', async () => {
    const app = await mount()
    try {
      app.sessions.list.set(listState({ turn: 0, running: true, current: 'other' }))
      app.sessions.list.set(listState({ turn: 1, reason: 'completed', running: false, completed: true, current: 'other' }))
      vi.advanceTimersByTime(400)

      expect(notifications.map(entry => entry.title)).toEqual([zh['notify.completed']])
      expect(audio.map(element => element.source)).toEqual([SOUND_SOURCES.completed])
      // The finished session is not the visible one, so it also leaves an unread title marker.
      expect(document.title).toContain('已完成')
    } finally {
      await app.dispose()
    }
  })

  it('keeps the result silent when sounds are switched off', async () => {
    persistedSettings({ soundsEnabled: false })
    const app = await mount()
    try {
      app.sessions.list.set(listState({ turn: 0, running: true }))
      app.sessions.list.set(listState({ turn: 1, reason: 'error', running: false, completed: true }))
      vi.advanceTimersByTime(400)

      expect(notifications.map(entry => entry.title)).toEqual([zh['notify.error']])
      expect(audio).toEqual([])
    } finally {
      await app.dispose()
    }
  })
})

describe('client composition: approval request', () => {
  it('alerts, plays its own clip, and still delegates the decision', async () => {
    const app = await mount()
    try {
      const listener = app.remote.approval
      expect(listener).toBeDefined()
      // The request arrives while the user is looking elsewhere.
      app.sessions.list.set(listState({ current: 'other' }))
      const outcome = { kind: 'allowed-once' }
      const next = vi.fn().mockResolvedValue(outcome)
      const result = await listener?.call({}, { toolName: 'bash', reason: 'rm -rf build' }, next)

      expect(result).toBe(outcome)
      expect(next).toHaveBeenCalledOnce()
      expect(notifications.map(entry => entry.title)).toEqual([zh['notify.approval']])
      expect(notifications[0]?.body).toContain('bash: rm -rf build')
      expect(audio.map(element => element.source)).toEqual([SOUND_SOURCES.approval])
      // Waiting for a decision is an attention state, not a silent one.
      expect(document.title).toContain('等待授权')
    } finally {
      await app.dispose()
    }
  })

  it('honours the approval switch and skips already-cancelled requests', async () => {
    persistedSettings({ notifyApproval: false })
    const app = await mount()
    try {
      const listener = app.remote.approval
      const next = vi.fn().mockResolvedValue({ kind: 'rejected' })
      await listener?.call({}, { toolName: 'bash' }, next)
      expect(notifications).toEqual([])
      expect(audio).toEqual([])
      expect(next).toHaveBeenCalledOnce()
    } finally {
      await app.dispose()
    }
  })

  it('drops the alert for an aborted request but keeps delegating', async () => {
    const app = await mount()
    try {
      const listener = app.remote.approval
      const next = vi.fn().mockResolvedValue({ kind: 'unavailable' })
      const controller = new AbortController()
      controller.abort()
      await listener?.call({}, { toolName: 'bash', signal: controller.signal } as never, next)
      expect(notifications).toEqual([])
      expect(next).toHaveBeenCalledOnce()
    } finally {
      await app.dispose()
    }
  })
})
