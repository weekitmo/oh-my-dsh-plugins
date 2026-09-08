import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-jobs'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import { createDingTalkRoute, DingTalkService } from './dingtalk.ts'
import { HostNotificationCoordinator } from './host-notification.ts'
import { notifyProjection } from './projection.ts'
import type { ResolvedConfig } from './types.ts'

export const name = '@weekit/dsh-notify'
export const inject = ['agents', 'jobs', 'sessions', 'sessionProjections', 'sessionTitle', 'webServer']

export interface Config {}

export const Config = z.object({})

async function resolvedSessionTitle(ctx: Context, session: Session): Promise<string> {
  const existing = ctx.sessionTitle.get(session)
  const firstCompletedTurn = session.events.filter(event => event.type === 'turn/end').length === 1
  if (existing !== undefined && (existing.source.kind !== 'fallback' || !firstCompletedTurn)) {
    return existing.title.trim() || String(session.id)
  }
  try {
    const refreshed = await ctx.sessionTitle.refresh(session, AbortSignal.timeout(15_000))
    const title = refreshed?.title.trim()
    return title === undefined || title === '' ? String(session.id) : title
  } catch (error) {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    const fallback = existing?.title.trim()
    return fallback === undefined || fallback === '' ? String(session.id) : fallback
  }
}

export async function apply(ctx: Context, config?: Config): Promise<void> {
  Config(config ?? {})
  const resolved: ResolvedConfig = { maxBodyChars: 2000 }
  ctx.sessionProjections.register(notifyProjection(resolved))

  const dingTalk = new DingTalkService()
  await dingTalk.initialize()
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/dsh-notify/dingtalk',
      handler: createDingTalkRoute(dingTalk),
    }),
    'dsh-notify: DingTalk API',
  )
  ctx.effect(() => () => { dingTalk.dispose() }, 'dsh-notify: DingTalk service')

  const coordinator = new HostNotificationCoordinator({
    agents: ctx.agents,
    jobs: ctx.jobs,
    sessions: ctx.sessions,
    maxBodyChars: resolved.maxBodyChars,
    async publish(candidate, signal): Promise<void> {
      if (signal.aborted || !dingTalk.enabledFor(candidate.reason)) return
      const title = await resolvedSessionTitle(ctx, candidate.session)
      if (signal.aborted || !dingTalk.enabledFor(candidate.reason)) return
      await dingTalk.notify({
        eventId: String(candidate.session.id) + ':' + String(candidate.turn),
        sessionId: String(candidate.session.id),
        turn: candidate.turn,
        reason: candidate.reason,
        title,
        body: candidate.body,
      })
    },
    onError(error): void {
      ctx.logger.warn(error)
    },
  })
  ctx.effect(() => coordinator.attach(ctx), 'dsh-notify: completion coordinator')
}
