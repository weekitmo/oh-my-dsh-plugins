import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot, JobsChangedListener } from '@deepseek-ai/dsh-jobs'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { DingTalkService } from '../src/dingtalk.ts'
import { HOST_CONVERGENCE_WINDOW_MS } from '../src/host-notification.ts'
import * as plugin from '../src/index.ts'

function reply(text: string) {
  return createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'test', model: 'test' } })
}

const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 } as const

class TestAgents extends Service {
  readonly values = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  get(id: SessionId): Agent | undefined {
    return this.values.get(String(id))
  }

  list(): Agent[] {
    return [...this.values.values()]
  }
}

class TestJobs extends Service {
  readonly listeners = new Set<JobsChangedListener>()

  constructor(ctx: Context) {
    super(ctx, 'jobs')
  }

  list(_owner?: Agent): JobSnapshot[] {
    return []
  }

  onJobsChanged(listener: JobsChangedListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

async function mountHost(ctx: Context): Promise<void> {
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TestAgents)
  await ctx.plugin(TestJobs)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
}

describe('dsh-notify host composition', () => {
  it('registers the projection, projects a turn, and removes it on disposal', async () => {
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-notify-composition-'))
    const ctx = new Context()
    await mountHost(ctx)
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
    await fiber

    const sessions = ctx.get('sessions') as SessionStore
    const session = sessions.create(undefined, { meta: { cwd: '/tmp/dsh-notify' } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, message: reply('deployment failed') }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })

    const projections = ctx.get('sessionProjections') as SessionProjectionRegistry
    expect(projections.snapshot(session).values.dshNotify).toEqual({
      turn: 1,
      reason: 'error',
      body: 'deployment failed',
      startedAsyncDelegation: false,
    })

    await fiber.dispose()
    expect(projections.snapshot(session).values.dshNotify).toBeUndefined()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('sends a completed turn from the host session event feed', async () => {
    const previousHome = process.env.DSH_HOME
    const home = await mkdtemp(join(tmpdir(), 'dsh-notify-host-event-'))
    process.env.DSH_HOME = home
    await mkdir(join(home, 'dsh-notify'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'dsh-notify', 'settings.json'), JSON.stringify({
      accessToken: 'test-token',
      signingSecret: 'test-secret',
      notifyCompleted: true,
      notifyFailed: false,
      quietHoursEnabled: false,
      quietHoursStart: '23:00',
      quietHoursEnd: '08:00',
      notifyMissed: true,
    }), { mode: 0o600 })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"errcode":0,"errmsg":"ok"}'))
    vi.stubGlobal('fetch', request)

    const ctx = new Context()
    await mountHost(ctx)
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
    await fiber
    const sessions = ctx.get('sessions') as SessionStore
    const session = sessions.create(undefined, { meta: { cwd: '/tmp/dsh-notify' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Generated deployment title' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, message: reply('host notification body') }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    const [url, init] = request.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('access_token')).toBe('test-token')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      msgtype: 'markdown',
      markdown: {
        title: 'DSH 任务已完成',
        text: expect.stringMatching(/Generated deployment title[\s\S]*host notification body/),
      },
    })
    await fiber.dispose()
    vi.unstubAllGlobals()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('does not admit a COI startup turn and sends only the later summary turn', async () => {
    const previousHome = process.env.DSH_HOME
    const home = await mkdtemp(join(tmpdir(), 'dsh-notify-coi-event-'))
    process.env.DSH_HOME = home
    await mkdir(join(home, 'dsh-notify'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'dsh-notify', 'settings.json'), JSON.stringify({
      accessToken: 'test-token',
      signingSecret: 'test-secret',
      notifyCompleted: true,
      notifyFailed: true,
      quietHoursEnabled: false,
      quietHoursStart: '23:00',
      quietHoursEnd: '08:00',
      notifyMissed: true,
    }), { mode: 0o600 })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"errcode":0,"errmsg":"ok"}'))
    vi.stubGlobal('fetch', request)

    const ctx = new Context()
    await mountHost(ctx)
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
    await fiber
    const sessions = ctx.get('sessions') as SessionStore
    const session = sessions.create(undefined, { meta: { cwd: '/tmp/dsh-notify' } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-coi' as never,
      name: 'de_coi_dispatch',
      arguments: '{}',
    })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise(resolve => setTimeout(resolve, HOST_CONVERGENCE_WINDOW_MS + 25))
    expect(request).not.toHaveBeenCalled()
    await expect(readFile(join(home, 'dsh-notify', 'dingtalk-missed.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })

    session.append('turn/start', { turn: 2 })
    session.append('step/start', { turn: 2, step: 1 })
    session.append('assistant/message', {
      turn: 2,
      step: 1,
      message: reply('all delegated work is complete'),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toMatchObject({
      markdown: {
        text: expect.stringContaining('all delegated work is complete'),
      },
    })
    await fiber.dispose()
    vi.unstubAllGlobals()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('does not forward a subagent completion to DingTalk', async () => {
    const previousHome = process.env.DSH_HOME
    const home = await mkdtemp(join(tmpdir(), 'dsh-notify-subagent-event-'))
    process.env.DSH_HOME = home
    await mkdir(join(home, 'dsh-notify'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'dsh-notify', 'settings.json'), JSON.stringify({
      accessToken: 'test-token',
      signingSecret: 'test-secret',
      notifyCompleted: true,
      notifyFailed: true,
      quietHoursEnabled: false,
      quietHoursStart: '23:00',
      quietHoursEnd: '08:00',
      notifyMissed: false,
    }), { mode: 0o600 })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"errcode":0,"errmsg":"ok"}'))
    vi.stubGlobal('fetch', request)

    const ctx = new Context()
    await mountHost(ctx)
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
    await fiber
    const sessions = ctx.get('sessions') as SessionStore
    const session = sessions.create(undefined, { meta: { cwd: '/tmp/dsh-notify', origin: 'subagent' } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, message: reply('subagent result') }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(request).not.toHaveBeenCalled()
    await fiber.dispose()
    vi.unstubAllGlobals()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('rejects every subagent failure outcome before DingTalk admission', async () => {
    const previousHome = process.env.DSH_HOME
    const home = await mkdtemp(join(tmpdir(), 'dsh-notify-subagent-failures-'))
    process.env.DSH_HOME = home
    await mkdir(join(home, 'dsh-notify'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'dsh-notify', 'settings.json'), JSON.stringify({
      accessToken: 'test-token',
      signingSecret: 'test-secret',
      notifyCompleted: true,
      notifyFailed: true,
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
      notifyMissed: true,
    }), { mode: 0o600 })
    const admission = vi.spyOn(DingTalkService.prototype, 'enabledFor')

    const ctx = new Context()
    await mountHost(ctx)
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {})
    await fiber
    const sessions = ctx.get('sessions') as SessionStore
    const reasons = [
      { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } },
      { kind: 'aborted', reason: { kind: 'user' } },
      { kind: 'interrupted' },
      { kind: 'blocked' },
      { kind: 'max-tokens' },
    ] as const
    for (const reason of reasons) {
      const session = sessions.create(undefined, {
        meta: {
          cwd: '/tmp/dsh-notify',
          parentSession: 'session-parent' as SessionId,
          origin: 'subagent',
          delegationDepth: 1,
        },
      })
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason })
    }

    expect(admission).not.toHaveBeenCalled()
    await expect(readFile(join(home, 'dsh-notify', 'dingtalk-missed.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await fiber.dispose()
    admission.mockRestore()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('accepts but no longer applies the legacy host body-length field', () => {
    expect(plugin.Config({})).toEqual({})
    expect(plugin.Config({ maxBodyChars: 400 })).toEqual({ maxBodyChars: 400 })
  })
})
