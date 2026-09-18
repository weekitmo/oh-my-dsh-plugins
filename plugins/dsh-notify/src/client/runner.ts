import type { AttentionEntry, NotificationReason, NotifyProjectionValue } from '../contract.ts'
import { asReason, toneOf } from './decision.ts'

export const CONVERGENCE_WINDOW_MS = 250

export function projectionAdvance(
  previousTurn: number | undefined,
  projection: NotifyProjectionValue | undefined,
): { readonly turn: number; readonly fresh: boolean } {
  const turn = projection?.turn ?? previousTurn ?? 0
  return { turn, fresh: projection !== undefined && previousTurn !== undefined && turn > previousTurn }
}

export interface CompletionSessionSummary {
  readonly id: string
  readonly displayTitle: string
  readonly parentId?: string
  readonly origin?: 'subagent'
  readonly running: boolean
  /** Host edge marker for a completion that happened while this session was not selected. */
  readonly completed?: boolean
  readonly projectionValues?: {
    readonly dshNotify?: NotifyProjectionValue
    readonly goal?: { readonly goal?: { readonly phase?: string } } | null
  }
}

export interface CompletionJobSummary {
  readonly id: string
  readonly status: string
}

export interface CompletionListSnapshot {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, CompletionSessionSummary | undefined>>
  readonly jobsBySession: Readonly<Record<string, readonly CompletionJobSummary[] | undefined>>
  readonly phase?: string
}

export interface CompletionCandidate {
  readonly sessionId: string
  readonly turn: number
  readonly reason: NotificationReason
  readonly title: string
  readonly body: string
  readonly startedAsyncDelegation: boolean
}

export interface CompletionState {
  readonly observed: Readonly<Record<string, number>>
  /** Last host completion-reminder bit, used to admit a marker arriving after its projection. */
  readonly completed: Readonly<Record<string, boolean>>
  readonly pending: Readonly<Record<string, CompletionCandidate>>
  readonly published: Readonly<Record<string, number>>
  readonly settling: Readonly<Record<string, {
    readonly turn: number
    readonly readyAt: number
  }>>
}

export interface CompletionAdvance {
  readonly state: CompletionState
  readonly published: readonly AttentionEntry[]
  readonly nextCheckAt?: number
}

export function seedCompletionState(snapshot: CompletionListSnapshot): CompletionState {
  const observed: Record<string, number> = {}
  const published: Record<string, number> = {}
  const completed: Record<string, boolean> = {}
  for (const id of snapshot.ids) {
    const turn = snapshot.byId[id]?.projectionValues?.dshNotify?.turn ?? 0
    observed[id] = turn
    published[id] = turn
    completed[id] = snapshot.byId[id]?.completed === true
  }
  return { observed, completed, pending: {}, published, settling: {} }
}

function belongsToTask(
  snapshot: CompletionListSnapshot,
  sessionId: string,
  rootId: string,
): boolean {
  if (sessionId === rootId) return true
  let current = snapshot.byId[sessionId]
  const visited = new Set<string>()
  while (current?.origin === 'subagent' && current.parentId !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.parentId === rootId) return true
    current = snapshot.byId[current.parentId]
  }
  return false
}

function hasLiveJobs(snapshot: CompletionListSnapshot, sessionId: string): boolean {
  return snapshot.ids.some(id =>
    belongsToTask(snapshot, id, sessionId)
      && (snapshot.jobsBySession[id] ?? [])
        .some(job => job.status === 'running' || job.status === 'stopping'),
  )
}

function hasRunningSubagentDescendant(
  snapshot: CompletionListSnapshot,
  ancestorId: string,
): boolean {
  for (const id of snapshot.ids) {
    const initial = snapshot.byId[id]
    if (initial?.origin !== 'subagent' || initial.running !== true) continue
    if (belongsToTask(snapshot, id, ancestorId)) return true
  }
  return false
}

function candidateOf(
  sessionId: string,
  summary: CompletionSessionSummary,
  projection: NotifyProjectionValue | undefined,
): CompletionCandidate | undefined {
  if (summary.origin === 'subagent' || projection === undefined) return undefined
  const reason = asReason(projection.reason)
  if (reason === undefined) return undefined
  return {
    sessionId,
    turn: projection.turn,
    reason,
    title: summary.displayTitle,
    body: projection.body,
    startedAsyncDelegation: projection.startedAsyncDelegation === true,
  }
}

function removeMissing(
  record: Record<string, unknown>,
  live: ReadonlySet<string>,
): void {
  for (const id of Object.keys(record)) {
    if (!live.has(id)) delete record[id]
  }
}

export function advanceCompletionState(
  previous: CompletionState,
  snapshot: CompletionListSnapshot,
  now: number,
): CompletionAdvance {
  const observed: Record<string, number> = { ...previous.observed }
  const completed: Record<string, boolean> = { ...previous.completed }
  const pending: Record<string, CompletionCandidate> = { ...previous.pending }
  const publishedTurns: Record<string, number> = { ...previous.published }
  const settling: Record<string, { turn: number; readyAt: number }> = { ...previous.settling }
  const published: AttentionEntry[] = []

  for (const id of snapshot.ids) {
    const summary = snapshot.byId[id]
    if (summary === undefined) continue
    const projection = summary.projectionValues?.dshNotify
    const priorObserved = observed[id]
    const wasCompleted = completed[id] === true
    completed[id] = summary.completed === true

    if (priorObserved === undefined) {
      const baseline = projection?.turn ?? 0
      observed[id] = baseline
      publishedTurns[id] = baseline
      delete pending[id]
      delete settling[id]
      const completedCandidate = summary.completed === true ? candidateOf(id, summary, projection) : undefined
      if (completedCandidate !== undefined) {
        publishedTurns[id] = Math.max(0, baseline - 1)
        pending[id] = completedCandidate
      }
    }

    if (priorObserved !== undefined && projection !== undefined && projection.turn > priorObserved) {
      observed[id] = projection.turn
      delete settling[id]
      const reason = asReason(projection.reason)
      if (summary.origin === 'subagent' || reason === undefined) {
        publishedTurns[id] = projection.turn
        delete pending[id]
      } else {
        pending[id] = {
          sessionId: id,
          turn: projection.turn,
          reason,
          title: summary.displayTitle,
          body: projection.body,
          startedAsyncDelegation: projection.startedAsyncDelegation === true,
        }
      }
    }

    if (!wasCompleted && summary.completed === true && projection !== undefined && pending[id] === undefined) {
      const completedCandidate = candidateOf(id, summary, projection)
      if (completedCandidate !== undefined && completedCandidate.turn >= (publishedTurns[id] ?? 0)) {
        publishedTurns[id] = Math.max(0, completedCandidate.turn - 1)
        pending[id] = completedCandidate
      }
    }

    const candidate = pending[id]
    if (candidate === undefined) {
      delete settling[id]
      continue
    }
    if (summary.origin === 'subagent' || candidate.turn <= (publishedTurns[id] ?? 0)) {
      delete pending[id]
      delete settling[id]
      continue
    }

    if (candidate.title !== summary.displayTitle) {
      pending[id] = { ...candidate, title: summary.displayTitle }
    }
    const currentCandidate = pending[id]!
    const activeGoal = summary.projectionValues?.goal?.goal?.phase === 'active'
    const eligible = summary.running !== true
      && !activeGoal
      && !currentCandidate.startedAsyncDelegation
      && !hasLiveJobs(snapshot, id)
      && !hasRunningSubagentDescendant(snapshot, id)
    if (!eligible) {
      delete settling[id]
      continue
    }

    const window = settling[id]
    if (window === undefined || window.turn !== currentCandidate.turn) {
      settling[id] = {
        turn: currentCandidate.turn,
        readyAt: now + CONVERGENCE_WINDOW_MS,
      }
      continue
    }
    if (now < window.readyAt) continue

    publishedTurns[id] = currentCandidate.turn
    delete pending[id]
    delete settling[id]
    published.push({
      sessionId: currentCandidate.sessionId,
      turn: currentCandidate.turn,
      reason: currentCandidate.reason,
      tone: toneOf(currentCandidate.reason),
      title: currentCandidate.title,
      body: currentCandidate.body,
      createdAt: now,
    })
  }

  if (snapshot.phase === 'ready') {
    const live = new Set(snapshot.ids)
    removeMissing(observed, live)
    removeMissing(completed, live)
    removeMissing(pending, live)
    removeMissing(publishedTurns, live)
    removeMissing(settling, live)
  }

  let nextCheckAt: number | undefined
  for (const window of Object.values(settling)) {
    if (nextCheckAt === undefined || window.readyAt < nextCheckAt) nextCheckAt = window.readyAt
  }

  return {
    state: {
      observed,
      completed,
      pending,
      published: publishedTurns,
      settling,
    },
    published,
    ...(nextCheckAt === undefined ? {} : { nextCheckAt }),
  }
}

type TimerHandle = ReturnType<typeof setTimeout>

/**
 * Timer seats resolve through the global scope: a bare `setTimeout` reference
 * called as `this.setTimer(...)` binds the runner instance as receiver, which
 * browsers reject with `TypeError: Illegal invocation` (Node tolerates it, so
 * only the real client surfaces the failure).
 */
function defaultSetTimer(callback: () => void, delayMs: number): TimerHandle {
  return globalThis.setTimeout(callback, delayMs)
}

function defaultClearTimer(handle: TimerHandle): void {
  globalThis.clearTimeout(handle)
}

export interface CompletionRunnerOptions {
  readonly publish: (entry: AttentionEntry) => void
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  readonly clearTimer?: (handle: TimerHandle) => void
  /** Failure sink for publish/timer faults; the runner never propagates them. */
  readonly onError?: (error: Error) => void
}

/** Report one runner fault without breaking the owning notification loop. */
function defaultOnError(error: Error): void {
  console.warn('[dsh-notify] completion runner failed', error)
}

/**
 * Client-side completion state machine: folds the harness session-list snapshot
 * into final attention entries, waiting out a short convergence window so job
 * settlement and follow-up wake-ups cannot split one task into two results.
 */
export class CompletionRunner {
  private state: CompletionState
  private snapshot: CompletionListSnapshot
  private readonly publish: (entry: AttentionEntry) => void
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void
  private readonly onError: (error: Error) => void
  private timer: TimerHandle | undefined
  private disposed = false

  constructor(snapshot: CompletionListSnapshot, options: CompletionRunnerOptions) {
    this.snapshot = snapshot
    this.state = seedCompletionState(snapshot)
    this.publish = options.publish
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? defaultSetTimer
    this.clearTimer = options.clearTimer ?? defaultClearTimer
    this.onError = options.onError ?? defaultOnError
  }

  update(snapshot: CompletionListSnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    this.evaluate()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelTimer()
  }

  private evaluate(): void {
    this.cancelTimer()
    const now = this.now()
    let result: CompletionAdvance
    try {
      result = advanceCompletionState(this.state, this.snapshot, now)
    } catch (error) {
      this.report(error)
      return
    }
    this.state = result.state
    for (const entry of result.published) {
      try {
        this.publish(entry)
      } catch (error) {
        this.report(error)
      }
    }
    if (result.nextCheckAt === undefined || this.disposed) return
    try {
      this.timer = this.setTimer(() => {
        this.timer = undefined
        if (!this.disposed) this.evaluate()
      }, Math.max(0, result.nextCheckAt - now))
    } catch (error) {
      this.timer = undefined
      this.report(error)
    }
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return
    const handle = this.timer
    this.timer = undefined
    try {
      this.clearTimer(handle)
    } catch (error) {
      this.report(error)
    }
  }

  private report(error: unknown): void {
    this.onError(error instanceof Error ? error : new Error(String(error)))
  }
}
