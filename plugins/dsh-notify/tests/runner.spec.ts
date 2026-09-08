import { describe, expect, it, vi } from 'vitest'
import type { AttentionEntry, NotifyProjectionValue } from '../src/contract.ts'
import {
  advanceCompletionState,
  CompletionRunner,
  CONVERGENCE_WINDOW_MS,
  projectionAdvance,
  seedCompletionState,
  type CompletionListSnapshot,
} from '../src/client/runner.ts'
import { attentionEntries, putAttention, type AttentionState } from '../src/client/state.ts'
import { aggregatedTitle } from '../src/client/title.ts'

function projection(
  reason: string,
  turn = 1,
  startedAsyncDelegation = false,
): NotifyProjectionValue {
  return { turn, reason, body: `${reason} body`, startedAsyncDelegation }
}

function snapshot(options: {
  readonly turn?: number
  readonly reason?: string
  readonly running?: boolean
  readonly async?: boolean
  readonly jobs?: readonly ('running' | 'stopping' | 'completed' | 'failed' | 'killed')[]
  readonly jobsBySession?: Readonly<Record<string, readonly (
    'running' | 'stopping' | 'completed' | 'failed' | 'killed'
  )[]>>
  readonly children?: Readonly<Record<string, {
    readonly parentId: string
    readonly origin?: 'subagent'
    readonly running: boolean
    readonly completed?: boolean
    readonly projection?: NotifyProjectionValue
  }>>
  readonly parentId?: string
  readonly origin?: 'subagent'
  readonly goalPhase?: 'active' | 'paused' | 'blocked' | 'complete'
} = {}): CompletionListSnapshot {
  const main = {
    id: 'main',
    displayTitle: 'Main session',
    running: options.running ?? false,
    parentId: options.parentId,
    origin: options.origin,
    projectionValues: {
      dshNotify: projection(
        options.reason ?? '',
        options.turn ?? 0,
        options.async ?? false,
      ),
      ...(options.goalPhase === undefined ? {} : {
        goal: { goal: { phase: options.goalPhase } },
      }),
    },
  }
  const children = options.children ?? {}
  return {
    ids: ['main', ...Object.keys(children)],
    byId: {
      main,
      ...Object.fromEntries(Object.entries(children).map(([id, value]) => [id, {
        id,
        displayTitle: id,
        ...value,
        ...(value.projection === undefined ? {} : { projectionValues: { dshNotify: value.projection } }),
      }])),
    },
    jobsBySession: {
      main: (options.jobs ?? []).map((status, index) => ({ id: `job-${String(index)}`, status })),
      ...Object.fromEntries(Object.entries(options.jobsBySession ?? {}).map(([id, statuses]) => [
        id,
        statuses.map((status, index) => ({ id: `${id}-job-${String(index)}`, status })),
      ])),
    },
    phase: 'ready',
  }
}

function advance(
  state: ReturnType<typeof seedCompletionState>,
  value: CompletionListSnapshot,
  now: number,
) {
  return advanceCompletionState(state, value, now)
}

describe('projectionAdvance', () => {
  it('seeds without notifying history and advances only later turns', () => {
    expect(projectionAdvance(undefined, projection('completed', 4)))
      .toEqual({ turn: 4, fresh: false })
    expect(projectionAdvance(4, projection('error', 5)))
      .toEqual({ turn: 5, fresh: true })
    expect(projectionAdvance(5, projection('error', 5)))
      .toEqual({ turn: 5, fresh: false })
  })

  it('keeps the previous watermark while a reconnect omits projections', () => {
    expect(projectionAdvance(undefined, undefined)).toEqual({ turn: 0, fresh: false })
    expect(projectionAdvance(5, undefined)).toEqual({ turn: 5, fresh: false })
    expect(projectionAdvance(5, projection('completed', 6)))
      .toEqual({ turn: 6, fresh: true })
  })
})

describe('completion attention state machine', () => {
  it('publishes once after a main session transitions from running to settled idle', () => {
    let state = seedCompletionState(snapshot({ running: true }))
    let result = advance(state, snapshot({ turn: 1, reason: 'completed', running: true }), 10)
    state = result.state
    expect(result.published).toEqual([])
    expect(result.nextCheckAt).toBeUndefined()

    result = advance(state, snapshot({ turn: 1, reason: 'completed', running: false }), 20)
    state = result.state
    expect(result.nextCheckAt).toBe(20 + CONVERGENCE_WINDOW_MS)
    expect(result.published).toEqual([])

    result = advance(state, snapshot({ turn: 1, reason: 'completed' }), 20 + CONVERGENCE_WINDOW_MS)
    state = result.state
    expect(result.published).toEqual([expect.objectContaining({ sessionId: 'main', turn: 1, reason: 'completed' })])
    expect(advance(state, snapshot({ turn: 1, reason: 'completed' }), 1000).published).toEqual([])
  })

  it('publishes a newly listed session that is already settled', () => {
    let state = seedCompletionState(snapshot())
    const result = advance(state, snapshot({
      children: {
        new: { parentId: 'workspace', running: false, completed: true, projection: projection('completed', 1) },
      },
    }), 10)
    expect(result.nextCheckAt).toBe(10 + CONVERGENCE_WINDOW_MS)
    expect(result.published).toEqual([])
    expect(advance(
      result.state,
      snapshot({
        children: {
          new: { parentId: 'workspace', running: false, completed: true, projection: projection('completed', 1) },
        },
      }),
      10 + CONVERGENCE_WINDOW_MS,
    ).published).toEqual([expect.objectContaining({ sessionId: 'new', turn: 1, reason: 'completed' })])
  })

  it('waits for the host completion marker when projection arrives first', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({
      children: {
        new: { parentId: 'workspace', running: false, projection: projection('completed', 1) },
      },
    }), 10)
    state = result.state
    expect(result.published).toEqual([])
    expect(result.nextCheckAt).toBeUndefined()

    result = advance(state, snapshot({
      children: {
        new: { parentId: 'workspace', running: false, completed: true, projection: projection('completed', 1) },
      },
    }), 20)
    expect(result.nextCheckAt).toBe(20 + CONVERGENCE_WINDOW_MS)
    expect(result.published).toEqual([])
  })

  it('blocks convergence while a job is running or stopping', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      jobs: ['running', 'stopping'],
    }), 10)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()

    result = advance(state, snapshot({ turn: 1, reason: 'completed', jobs: ['completed'] }), 20)
    state = result.state
    expect(result.nextCheckAt).toBe(20 + CONVERGENCE_WINDOW_MS)
    expect(advance(
      state,
      snapshot({ turn: 1, reason: 'completed', jobs: ['completed'] }),
      20 + CONVERGENCE_WINDOW_MS,
    ).published).toHaveLength(1)
  })

  it('cancels the job-settlement window when a synchronous followup wakes the Agent', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      jobs: ['running'],
    }), 10)
    state = result.state

    result = advance(state, snapshot({ turn: 1, reason: 'completed', jobs: ['completed'] }), 20)
    state = result.state
    const staleDeadline = result.nextCheckAt
    expect(staleDeadline).toBe(20 + CONVERGENCE_WINDOW_MS)

    result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      running: true,
      jobs: ['completed'],
    }), 21)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()
    expect(advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      running: true,
      jobs: ['completed'],
    }), staleDeadline!).published).toEqual([])
  })

  it('lets a later summary turn replace the old candidate and publishes only that turn', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({ turn: 1, reason: 'completed' }), 10)
    state = result.state
    const staleDeadline = result.nextCheckAt!

    result = advance(state, snapshot({ turn: 2, reason: 'error', running: true }), 20)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()
    expect(advance(state, snapshot({ turn: 2, reason: 'error', running: true }), staleDeadline).published)
      .toEqual([])

    result = advance(state, snapshot({ turn: 2, reason: 'error' }), 30)
    state = result.state
    result = advance(state, snapshot({ turn: 2, reason: 'error' }), 30 + CONVERGENCE_WINDOW_MS)
    state = result.state
    expect(result.published).toEqual([expect.objectContaining({ turn: 2, reason: 'error' })])
    expect(advance(state, snapshot({ turn: 2, reason: 'error' }), 1000).published).toEqual([])
  })

  it('waits for an active automatic goal to reach a terminal phase', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({ turn: 1, reason: 'completed', goalPhase: 'active' }), 10)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()
    expect(advance(
      state,
      snapshot({ turn: 1, reason: 'completed', goalPhase: 'active' }),
      1000,
    ).published).toEqual([])

    result = advance(state, snapshot({ turn: 2, reason: 'completed', goalPhase: 'complete' }), 1010)
    state = result.state
    expect(result.nextCheckAt).toBe(1010 + CONVERGENCE_WINDOW_MS)
    result = advance(
      state,
      snapshot({ turn: 2, reason: 'completed', goalPhase: 'complete' }),
      1010 + CONVERGENCE_WINDOW_MS,
    )
    expect(result.published).toEqual([expect.objectContaining({ turn: 2 })])
  })

  it('suppresses an async-dispatch turn and publishes the later main-Agent summary', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      async: true,
    }), 10)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()
    expect(advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      async: true,
    }), 1000).published).toEqual([])

    result = advance(state, snapshot({ turn: 2, reason: 'completed' }), 1010)
    state = result.state
    result = advance(state, snapshot({ turn: 2, reason: 'completed' }), 1010 + CONVERGENCE_WINDOW_MS)
    expect(result.published).toEqual([expect.objectContaining({ turn: 2, reason: 'completed' })])
  })

  it('waits for every running subagent descendant but not an ordinary fork branch', () => {
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      children: {
        child: { parentId: 'main', origin: 'subagent', running: true },
        fork: { parentId: 'main', running: true },
        grandchild: { parentId: 'fork', origin: 'subagent', running: true },
      },
    }), 10)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()

    result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      children: {
        child: { parentId: 'main', origin: 'subagent', running: false },
        fork: { parentId: 'main', running: true },
        grandchild: { parentId: 'fork', origin: 'subagent', running: true },
      },
      jobsBySession: { child: ['running'] },
    }), 20)
    state = result.state
    expect(result.nextCheckAt).toBeUndefined()

    result = advance(state, snapshot({
      turn: 1,
      reason: 'completed',
      children: {
        child: { parentId: 'main', origin: 'subagent', running: false },
        fork: { parentId: 'main', running: true },
        grandchild: { parentId: 'fork', origin: 'subagent', running: true },
      },
      jobsBySession: { child: ['completed'] },
    }), 30)
    expect(result.nextCheckAt).toBe(30 + CONVERGENCE_WINDOW_MS)
  })

  it.each(['completed', 'error', 'aborted', 'interrupted', 'blocked', 'max-tokens'])(
    'never publishes a subagent %s outcome',
    reason => {
      let state = seedCompletionState(snapshot({ origin: 'subagent' }))
      let result = advance(state, snapshot({ origin: 'subagent', turn: 1, reason }), 10)
      state = result.state
      expect(result.nextCheckAt).toBeUndefined()
      expect(advance(state, snapshot({ origin: 'subagent', turn: 1, reason }), 1000).published).toEqual([])
    },
  )

  it('treats an ordinary GUI fork as an independent task', () => {
    let state = seedCompletionState(snapshot({ parentId: 'parent' }))
    let result = advance(state, snapshot({
      parentId: 'parent',
      turn: 1,
      reason: 'completed',
    }), 10)
    state = result.state
    result = advance(state, snapshot({
      parentId: 'parent',
      turn: 1,
      reason: 'completed',
    }), 10 + CONVERGENCE_WINDOW_MS)
    expect(result.published).toEqual([expect.objectContaining({ sessionId: 'main', turn: 1 })])
  })

  it('feeds system, title, and sidebar from the same final AttentionEntry', () => {
    const systemNotification = vi.fn()
    const sidebarRender = vi.fn()
    let attention: AttentionState = { bySession: {} }
    let state = seedCompletionState(snapshot())
    let result = advance(state, snapshot({ turn: 1, reason: 'completed' }), 10)
    state = result.state
    expect(result.published).toEqual([])

    result = advance(state, snapshot({ turn: 1, reason: 'completed' }), 10 + CONVERGENCE_WINDOW_MS)
    for (const entry of result.published) {
      attention = putAttention(attention, entry)
      systemNotification(entry)
    }
    const entries: AttentionEntry[] = attentionEntries(attention)
    sidebarRender(entries)
    expect(systemNotification).toHaveBeenCalledWith(entries[0])
    expect(sidebarRender).toHaveBeenCalledWith(entries)
    expect(aggregatedTitle(entries, (reason, count) => `${String(count)} ${reason}`))
      .toBe('dsh (1 completed)')
  })
})

describe('CompletionRunner', () => {
  it('uses injectable timers and clears them on disposal', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const publish = vi.fn()
    const clearTimer = vi.fn(clearTimeout)
    const runner = new CompletionRunner(snapshot(), {
      publish,
      now: () => Date.now(),
      setTimer: setTimeout,
      clearTimer,
    })
    runner.update(snapshot({ turn: 1, reason: 'completed' }))
    expect(publish).not.toHaveBeenCalled()
    runner.dispose()
    vi.advanceTimersByTime(CONVERGENCE_WINDOW_MS)
    expect(clearTimer).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
