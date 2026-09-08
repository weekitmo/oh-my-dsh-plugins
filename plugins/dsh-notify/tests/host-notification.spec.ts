import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot, JobsChangedListener } from '@deepseek-ai/dsh-jobs'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationReason } from '../src/contract.ts'
import {
  HOST_CONVERGENCE_WINDOW_MS,
  HostNotificationCoordinator,
  hostNotificationReason,
  isTopLevelAgentSession,
} from '../src/host-notification.ts'

function header(meta: Partial<SessionHeader> = {}, id = 'session-test'): SessionHeader {
  return {
    version: 0,
    id: id as SessionHeader['id'],
    createdAt: 0,
    ...meta,
  }
}

function session(meta: Partial<SessionHeader> = {}, id = 'session-test'): Session {
  const value = header(meta, id)
  return { id: value.id, header: value, events: [] } as unknown as Session
}

function turnEnd(
  reason: SessionEvent<'turn/end'>['data']['reason'],
  turn = 1,
): SessionEvent<'turn/end'> {
  return {
    type: 'turn/end',
    seq: 0,
    time: 0,
    data: { turn, reason },
  }
}

function append(sessionValue: Session, event: SessionEvent): void {
  ;(sessionValue.events as SessionEvent[]).push(event)
}

interface MutableAgent extends Omit<Agent, 'status'> {
  status: AgentStatus
}

function agent(sessionValue: Session, status: AgentStatus = 'idle'): MutableAgent {
  return {
    id: sessionValue.id,
    session: sessionValue,
    status,
  } as MutableAgent
}

class FakeAgents {
  readonly values = new Map<string, MutableAgent>()

  get(id: SessionId): Agent | undefined {
    return this.values.get(String(id))
  }

  list(): Agent[] {
    return [...this.values.values()]
  }
}

class FakeSessions {
  readonly values = new Map<string, Session>()

  get(id: SessionId): Session | undefined {
    return this.values.get(String(id))
  }

  list(): Session[] {
    return [...this.values.values()]
  }
}

class FakeJobs {
  readonly byOwner = new Map<string, JobSnapshot[]>()
  readonly listeners = new Set<JobsChangedListener>()

  list(owner?: Agent): JobSnapshot[] {
    return owner === undefined ? [] : [...(this.byOwner.get(String(owner.id)) ?? [])]
  }

  onJobsChanged(listener: JobsChangedListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(owner: Agent, statuses: readonly JobSnapshot['status'][]): void {
    this.byOwner.set(String(owner.id), statuses.map((status, index) => ({
      id: `job-${String(index)}` as JobSnapshot['id'],
      kind: 'bash',
      label: 'test',
      ownerSession: owner.id,
      status,
      startedAt: 0,
      reported: false,
    })))
    for (const listener of this.listeners) listener(owner)
  }
}

function coordinatorFixture() {
  const agents = new FakeAgents()
  const sessions = new FakeSessions()
  const jobs = new FakeJobs()
  const publish = vi.fn()
  const coordinator = new HostNotificationCoordinator({
    agents,
    sessions,
    jobs,
    publish,
  })
  const add = (
    sessionValue: Session,
    status: AgentStatus = 'idle',
  ): MutableAgent => {
    const value = agent(sessionValue, status)
    sessions.values.set(String(sessionValue.id), sessionValue)
    agents.values.set(String(sessionValue.id), value)
    return value
  }
  return { agents, sessions, jobs, publish, coordinator, add }
}

const terminalReasons: readonly [
  SessionEvent<'turn/end'>['data']['reason'],
  NotificationReason,
][] = [
  [{ kind: 'completed' }, 'completed'],
  [{ kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } }, 'error'],
  [{ kind: 'aborted', reason: { kind: 'user' } }, 'aborted'],
  [{ kind: 'interrupted' }, 'aborted'],
  [{ kind: 'blocked' }, 'blocked'],
  [{ kind: 'max-tokens' }, 'max-tokens'],
]

describe('host notification admission', () => {
  it('allows root and ordinary fork sessions but rejects durable subagent metadata', () => {
    expect(isTopLevelAgentSession(header())).toBe(true)
    expect(isTopLevelAgentSession(header({
      parentSession: 'session-parent' as SessionHeader['id'],
      seedLength: 4,
    }))).toBe(true)
    expect(isTopLevelAgentSession(header({
      parentSession: 'session-parent' as SessionHeader['id'],
      origin: 'subagent',
      delegationDepth: 1,
    }))).toBe(false)
    expect(isTopLevelAgentSession(header({ delegationDepth: 2 }))).toBe(false)
  })

  it.each(terminalReasons)('maps a top-level %s result to %s', (reason, expected) => {
    expect(hostNotificationReason(session(), turnEnd(reason))).toBe(expected)
  })

  it.each(terminalReasons)('rejects a subagent %s result before DingTalk admission', (reason) => {
    expect(hostNotificationReason(session({
      parentSession: 'session-parent' as SessionHeader['id'],
      origin: 'subagent',
      delegationDepth: 1,
    }), turnEnd(reason))).toBeUndefined()
  })
})

describe('HostNotificationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for running to become idle before publishing once', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    const rootAgent = fixture.add(root, 'running')
    const end = turnEnd({ kind: 'completed' })
    append(root, end)
    fixture.coordinator.handleSessionEvent(root, end)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).not.toHaveBeenCalled()

    rootAgent.status = 'idle'
    fixture.coordinator.handleAgentStatus(rootAgent, 'idle')
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ session: root, turn: 1, reason: 'completed' }),
      expect.any(AbortSignal),
    )
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
  })

  it('blocks on live jobs and cancels the settle window when followup starts running', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    const rootAgent = fixture.add(root)
    fixture.jobs.set(rootAgent, ['running'])
    const first = turnEnd({ kind: 'completed' }, 1)
    append(root, first)
    fixture.coordinator.handleSessionEvent(root, first)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).not.toHaveBeenCalled()

    fixture.jobs.set(rootAgent, ['completed'])
    fixture.coordinator.handleJobsChanged(rootAgent)
    rootAgent.status = 'running'
    fixture.coordinator.handleAgentStatus(rootAgent, 'running')
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).not.toHaveBeenCalled()

    const second = turnEnd({ kind: 'completed' }, 2)
    append(root, second)
    fixture.coordinator.handleSessionEvent(root, second)
    rootAgent.status = 'idle'
    fixture.coordinator.handleAgentStatus(rootAgent, 'idle')
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.publish.mock.calls[0]![0]).toMatchObject({ turn: 2 })
  })

  it('waits for an active automatic goal to reach a terminal phase', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    fixture.add(root)
    append(root, {
      type: 'goal/change',
      seq: 0,
      time: 0,
      data: {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        goal: { id: 'goal-1', revision: 1, objective: 'ship', phase: 'active', maxGoalRounds: 4 },
        roundsStarted: 1,
        createdAt: 0,
        updatedAt: 0,
      },
    } as never)
    const first = turnEnd({ kind: 'completed' }, 1)
    append(root, first)
    fixture.coordinator.handleSessionEvent(root, first)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS * 2)
    expect(fixture.publish).not.toHaveBeenCalled()

    append(root, {
      type: 'goal/change',
      seq: 1,
      time: 1,
      data: {
        kind: 'goal/change',
        version: 1,
        operation: 'complete',
        goal: { id: 'goal-1', revision: 2, objective: 'ship', phase: 'complete', maxGoalRounds: 4 },
        roundsStarted: 2,
        createdAt: 0,
        updatedAt: 1,
      },
    } as never)
    const second = turnEnd({ kind: 'completed' }, 2)
    append(root, second)
    fixture.coordinator.handleSessionEvent(root, second)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.publish.mock.calls[0]![0]).toMatchObject({ turn: 2 })
  })

  it('suppresses a COI/background startup turn and publishes the later summary turn', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    fixture.add(root)
    append(root, {
      type: 'tool/call',
      seq: 0,
      time: 0,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-coi' as never,
        name: 'de_coi_dispatch',
        arguments: '{}',
      },
    })
    const first = turnEnd({ kind: 'completed' }, 1)
    append(root, first)
    fixture.coordinator.handleSessionEvent(root, first)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS * 2)
    expect(fixture.publish).not.toHaveBeenCalled()

    const second = turnEnd({ kind: 'completed' }, 2)
    append(root, second)
    fixture.coordinator.handleSessionEvent(root, second)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.publish.mock.calls[0]![0]).toMatchObject({ turn: 2 })
  })

  it('waits for running subagents and their live jobs', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    fixture.add(root)
    const child = session({
      parentSession: root.id,
      origin: 'subagent',
      delegationDepth: 1,
    }, 'child')
    const childAgent = fixture.add(child, 'running')
    fixture.jobs.set(childAgent, ['running'])
    const end = turnEnd({ kind: 'completed' })
    append(root, end)
    fixture.coordinator.handleSessionEvent(root, end)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).not.toHaveBeenCalled()

    childAgent.status = 'idle'
    fixture.coordinator.handleAgentStatus(childAgent, 'idle')
    fixture.jobs.set(childAgent, ['completed'])
    fixture.coordinator.handleJobsChanged(childAgent)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
  })

  it.each(terminalReasons)('never publishes a subagent %s outcome', async (reason) => {
    const fixture = coordinatorFixture()
    const child = session({
      parentSession: 'session-parent' as SessionId,
      origin: 'subagent',
      delegationDepth: 1,
    }, 'child')
    fixture.add(child)
    const end = turnEnd(reason)
    append(child, end)
    fixture.coordinator.handleSessionEvent(child, end)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS * 2)
    expect(fixture.publish).not.toHaveBeenCalled()
  })

  it('publishes an ordinary fork as an independent task', async () => {
    const fixture = coordinatorFixture()
    const fork = session({
      parentSession: 'session-parent' as SessionId,
      seedLength: 4,
    }, 'fork')
    fixture.add(fork)
    const end = turnEnd({ kind: 'completed' })
    append(fork, end)
    fixture.coordinator.handleSessionEvent(fork, end)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.publish.mock.calls[0]![0]).toMatchObject({ session: fork, turn: 1 })
  })

  it('aborts an in-flight pre-queue publication when new subagent work appears', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    fixture.add(root)
    let release: (() => void) | undefined
    fixture.publish.mockImplementation(() => new Promise<void>(resolve => {
      release = resolve
    }))
    const end = turnEnd({ kind: 'completed' })
    append(root, end)
    fixture.coordinator.handleSessionEvent(root, end)
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledOnce()
    const firstSignal = fixture.publish.mock.calls[0]![1] as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    const child = session({
      parentSession: root.id,
      origin: 'subagent',
      delegationDepth: 1,
    }, 'child')
    const childAgent = fixture.add(child, 'running')
    fixture.coordinator.handleAgentCreated(childAgent)
    expect(firstSignal.aborted).toBe(true)
    release?.()
    await Promise.resolve()

    childAgent.status = 'idle'
    fixture.coordinator.handleAgentStatus(childAgent, 'idle')
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).toHaveBeenCalledTimes(2)
    release?.()
  })

  it('cancels pending timers and publications on disposal', async () => {
    const fixture = coordinatorFixture()
    const root = session({}, 'main')
    fixture.add(root)
    const end = turnEnd({ kind: 'completed' })
    append(root, end)
    fixture.coordinator.handleSessionEvent(root, end)
    fixture.coordinator.dispose()
    await vi.advanceTimersByTimeAsync(HOST_CONVERGENCE_WINDOW_MS)
    expect(fixture.publish).not.toHaveBeenCalled()
  })
})
