import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { JobRegistry, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionStore,
} from '@deepseek-ai/dsh-session'
import type { NotificationReason } from './contract.ts'
import { turnHasUnsettledAsyncDelegation } from './projection.ts'

export const HOST_CONVERGENCE_WINDOW_MS = 250

type TimerHandle = ReturnType<typeof setTimeout>

export interface HostNotificationCandidate {
  readonly session: Session
  readonly turn: number
  readonly reason: NotificationReason
  readonly body: string
  readonly startedAsyncDelegation: boolean
}

interface AgentsFace {
  get(id: SessionId): Agent | undefined
  list(): Agent[]
}

interface JobsFace {
  list(owner?: Agent): JobSnapshot[]
  onJobsChanged(listener: (owner: Agent | undefined) => void): () => void
}

interface SessionsFace {
  get(id: SessionId): Session | undefined
  list(): Session[]
}

export interface HostNotificationCoordinatorOptions {
  readonly agents: AgentsFace
  readonly jobs: JobsFace
  readonly sessions: SessionsFace
  readonly publish: (
    candidate: HostNotificationCandidate,
    signal: AbortSignal,
  ) => void | PromiseLike<void>
  readonly maxBodyChars?: number
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  readonly clearTimer?: (handle: TimerHandle) => void
  readonly onError?: (error: Error) => void
}

interface SettleWindow {
  readonly turn: number
  readonly handle: TimerHandle
}

export function isTopLevelAgentSession(header: SessionHeader): boolean {
  return header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0
}

function notificationReason(event: SessionEvent<'turn/end'>): NotificationReason | undefined {
  switch (event.data.reason.kind) {
    case 'completed': return 'completed'
    case 'error': return 'error'
    case 'aborted':
    case 'interrupted': return 'aborted'
    case 'blocked': return 'blocked'
    case 'max-tokens': return 'max-tokens'
    default: return undefined
  }
}

export function hostNotificationReason(
  session: Session,
  event: SessionEvent<'turn/end'>,
): NotificationReason | undefined {
  if (!isTopLevelAgentSession(session.header)) return undefined
  return notificationReason(event)
}

function turnBody(session: Session, turn: number, maxChars: number): string {
  let body = ''
  for (const event of session.events) {
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    for (const block of event.data.message.content) {
      if (block.type === 'text') body += block.text
    }
  }
  return Array.from(body.trim()).slice(0, maxChars).join('')
}

function turnStartedAsyncDelegation(session: Session, turn: number): boolean {
  return turnHasUnsettledAsyncDelegation(session.events, turn)
}

function liveJob(snapshot: JobSnapshot): boolean {
  return snapshot.status === 'running' || snapshot.status === 'stopping'
}

function hasActiveGoal(session: Session): boolean {
  const events = session.events as readonly unknown[]
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || Array.isArray(event)) continue
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'goal/change') continue
    const data = eventRecord.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return false
    const record = data as Record<string, unknown>
    if (record.kind !== 'goal/change') return false
    if (record.operation === 'clear') return false
    const goal = record.goal
    if (goal === null || typeof goal !== 'object' || Array.isArray(goal)) return false
    return (goal as Record<string, unknown>).phase === 'active'
  }
  return false
}

export class HostNotificationCoordinator {
  private readonly agents: AgentsFace
  private readonly jobs: JobsFace
  private readonly sessions: SessionsFace
  private readonly publish: HostNotificationCoordinatorOptions['publish']
  private readonly maxBodyChars: number
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void
  private readonly onError: (error: Error) => void
  private readonly pending = new Map<string, HostNotificationCandidate>()
  private readonly published = new Map<string, number>()
  private readonly windows = new Map<string, SettleWindow>()
  private readonly publishing = new Map<string, AbortController>()
  private readonly statuses = new Map<string, AgentStatus>()
  private disposed = false

  constructor(options: HostNotificationCoordinatorOptions) {
    this.agents = options.agents
    this.jobs = options.jobs
    this.sessions = options.sessions
    this.publish = options.publish
    this.maxBodyChars = options.maxBodyChars ?? 2000
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.onError = options.onError ?? (() => {})
    for (const agent of this.agents.list()) this.statuses.set(String(agent.id), agent.status)
  }

  attach(ctx: Context): () => void {
    const disposers = [
      ctx.on('session/event', (session, event) => {
        this.handleSessionEvent(session, event)
      }, { global: true }),
      ctx.on('session/disposed', session => {
        this.handleSessionDisposed(session)
      }, { global: true }),
      ctx.on('agent/status', ({ agent, status }) => {
        this.handleAgentStatus(agent, status)
      }, { global: true }),
      ctx.on('agent/created', ({ agent }) => {
        this.handleAgentCreated(agent)
      }, { global: true }),
      ctx.on('agent/disposed', ({ agent }) => {
        this.handleAgentDisposed(agent)
      }, { global: true }),
      this.jobs.onJobsChanged(owner => {
        this.handleJobsChanged(owner)
      }),
    ]
    let detached = false
    return () => {
      if (detached) return
      detached = true
      for (const dispose of disposers) dispose()
      this.dispose()
    }
  }

  handleSessionEvent(session: Session, event: SessionEvent): void {
    if (this.disposed) return
    if (event.type === 'turn/start') {
      const root = this.taskRoot(session)
      if (root === undefined) return
      if (root.id === session.id) this.cancelTask(String(root.id), true)
      else this.invalidateTask(String(root.id))
      return
    }
    if (event.type !== 'turn/end') return

    const reason = hostNotificationReason(session, event)
    if (reason === undefined) {
      this.reconsiderTaskFor(session)
      return
    }
    const id = String(session.id)
    if (event.data.turn <= (this.published.get(id) ?? 0)) return
    this.cancelTask(id, false)
    this.pending.set(id, {
      session,
      turn: event.data.turn,
      reason,
      body: turnBody(session, event.data.turn, this.maxBodyChars),
      startedAsyncDelegation: turnStartedAsyncDelegation(session, event.data.turn),
    })
    this.evaluate(id)
  }

  handleAgentStatus(agent: Agent, status: AgentStatus): void {
    if (this.disposed) return
    this.statuses.set(String(agent.id), status)
    const root = this.taskRoot(agent.session)
    if (root === undefined) return
    const rootId = String(root.id)
    if (status === 'running') {
      if (root.id === agent.id) this.cancelTask(rootId, true)
      else this.invalidateTask(rootId)
      return
    }
    this.evaluate(rootId)
  }

  handleAgentCreated(agent: Agent): void {
    if (this.disposed) return
    this.statuses.set(String(agent.id), agent.status)
    const root = this.taskRoot(agent.session)
    if (root === undefined) return
    if (agent.status === 'running') this.invalidateTask(String(root.id))
    else this.evaluate(String(root.id))
  }

  handleAgentDisposed(agent: Agent): void {
    if (this.disposed) return
    this.statuses.delete(String(agent.id))
    const root = this.taskRoot(agent.session)
    if (root !== undefined) this.evaluate(String(root.id))
  }

  handleJobsChanged(owner: Agent | undefined): void {
    if (this.disposed) return
    if (owner === undefined) {
      for (const id of this.pending.keys()) this.evaluate(id)
      return
    }
    this.reconsiderTaskFor(owner.session)
  }

  handleSessionDisposed(session: Session): void {
    if (this.disposed) return
    const root = this.taskRoot(session)
    const id = String(session.id)
    this.cancelTask(id, true)
    this.published.delete(id)
    this.statuses.delete(id)
    if (root !== undefined && root.id !== session.id) this.evaluate(String(root.id))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of [...this.windows.keys()]) this.cancelWindow(id)
    for (const controller of this.publishing.values()) controller.abort()
    this.publishing.clear()
    this.pending.clear()
    this.statuses.clear()
  }

  private reconsiderTaskFor(session: Session): void {
    const root = this.taskRoot(session)
    if (root !== undefined) this.evaluate(String(root.id))
  }

  private taskRoot(session: Session): Session | undefined {
    let current = session
    const visited = new Set<string>()
    while (current.header.origin === 'subagent') {
      const id = String(current.id)
      if (visited.has(id)) return undefined
      visited.add(id)
      const parentId = current.header.parentSession
      if (parentId === undefined) return undefined
      const parent = this.sessions.get(parentId)
      if (parent === undefined) return undefined
      current = parent
    }
    return isTopLevelAgentSession(current.header) ? current : undefined
  }

  private isSubagentDescendant(session: Session, ancestorId: SessionId): boolean {
    let current = session
    const visited = new Set<string>()
    while (current.header.origin === 'subagent') {
      const id = String(current.id)
      if (visited.has(id)) return false
      visited.add(id)
      const parentId = current.header.parentSession
      if (parentId === undefined) return false
      if (parentId === ancestorId) return true
      const parent = this.sessions.get(parentId)
      if (parent === undefined) return false
      current = parent
    }
    return false
  }

  private taskAgents(root: Session): Agent[] {
    return this.agents.list().filter(agent =>
      agent.id === root.id || this.isSubagentDescendant(agent.session, root.id),
    )
  }

  private statusOf(agent: Agent): AgentStatus {
    return this.statuses.get(String(agent.id)) ?? agent.status
  }

  private eligible(candidate: HostNotificationCandidate): boolean {
    if (candidate.startedAsyncDelegation || hasActiveGoal(candidate.session)) return false
    const rootAgent = this.agents.get(candidate.session.id)
    if (rootAgent !== undefined && this.statusOf(rootAgent) === 'running') return false

    const owners = this.taskAgents(candidate.session)
    for (const owner of owners) {
      if (owner.id !== candidate.session.id && this.statusOf(owner) === 'running') return false
      if (this.jobs.list(owner).some(liveJob)) return false
    }
    if (owners.length === 0 && this.jobs.list().some(liveJob)) return false
    return true
  }

  private evaluate(id: string): void {
    const candidate = this.pending.get(id)
    if (candidate === undefined) {
      this.cancelWindow(id)
      this.cancelPublishing(id)
      return
    }
    const eligible = candidate.turn > (this.published.get(id) ?? 0) && this.eligible(candidate)
    if (this.publishing.has(id)) {
      if (!eligible) this.cancelPublishing(id)
      return
    }
    if (!eligible) {
      this.cancelWindow(id)
      return
    }
    const existing = this.windows.get(id)
    if (existing?.turn === candidate.turn) return
    this.cancelWindow(id)
    const handle = this.setTimer(() => {
      const current = this.windows.get(id)
      if (current?.handle !== handle || current.turn !== candidate.turn) return
      this.windows.delete(id)
      const latest = this.pending.get(id)
      if (latest?.turn !== candidate.turn || !this.eligible(latest)) return
      this.beginPublish(id, latest)
    }, HOST_CONVERGENCE_WINDOW_MS)
    this.windows.set(id, { turn: candidate.turn, handle })
  }

  private beginPublish(id: string, candidate: HostNotificationCandidate): void {
    const controller = new AbortController()
    this.publishing.set(id, controller)
    let result: void | PromiseLike<void>
    try {
      result = this.publish(candidate, controller.signal)
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)))
      this.finishPublish(id, candidate.turn, controller)
      return
    }
    void Promise.resolve(result).catch(error => {
      this.onError(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => {
      this.finishPublish(id, candidate.turn, controller)
    })
  }

  private finishPublish(id: string, turn: number, controller: AbortController): void {
    if (this.publishing.get(id) !== controller) return
    this.publishing.delete(id)
    if (controller.signal.aborted) return
    this.published.set(id, turn)
    if (this.pending.get(id)?.turn === turn) this.pending.delete(id)
  }

  private cancelTask(id: string, clearPending: boolean): void {
    this.cancelWindow(id)
    this.cancelPublishing(id)
    if (clearPending) this.pending.delete(id)
  }

  private invalidateTask(id: string): void {
    this.cancelWindow(id)
    this.cancelPublishing(id)
  }

  private cancelPublishing(id: string): void {
    const controller = this.publishing.get(id)
    if (controller === undefined) return
    controller.abort()
    this.publishing.delete(id)
  }

  private cancelWindow(id: string): void {
    const window = this.windows.get(id)
    if (window === undefined) return
    this.clearTimer(window.handle)
    this.windows.delete(id)
  }
}

export type HostAgentRegistry = Pick<AgentRegistry, 'get' | 'list'>
export type HostJobRegistry = Pick<JobRegistry, 'list' | 'onJobsChanged'>
export type HostSessionStore = Pick<SessionStore, 'get' | 'list'>
