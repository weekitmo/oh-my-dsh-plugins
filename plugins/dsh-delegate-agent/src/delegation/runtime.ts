import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { ResolvedConfig } from '../config.ts'
import type {
  AdapterDescriptor, AdapterId, DelegateTask, PublicConfig, StartRequest, TaskList,
} from '../types.ts'
import { buildInvocation, commandPreview } from './adapters.ts'
import { ProtocolParser } from './protocol.ts'
import { DelegateTaskStore } from './store.ts'

interface ProcessOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
}

interface ProcessHandle {
  readonly pid: number
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly done: Promise<ProcessOutcome>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

export interface SubprocessRuntimeLike {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: { readonly stdin: 'ignore'; readonly stdout: 'pipe'; readonly stderr: 'pipe' }
    readonly graceMs: number
    readonly signal?: AbortSignal
    readonly env?: NodeJS.ProcessEnv
  }): ProcessHandle
}

type MutableTask = { -readonly [K in keyof DelegateTask]: DelegateTask[K] }

interface ActiveRun {
  readonly task: MutableTask
  readonly handle: ProcessHandle
  readonly controller: AbortController
  timedOut: boolean
  cancelled: boolean
  settlement: Promise<void>
}

const labels: Readonly<Record<AdapterId, string>> = { pi: 'Pi', codex: 'Codex', grok: 'Grok' }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !path.startsWith('/') && !path.startsWith('\\'))
}

function appendTail(current: string, chunk: string, totalBytes: number, maxBytes: number): {
  readonly text: string
  readonly totalBytes: number
  readonly truncated: boolean
} {
  const nextTotal = totalBytes + Buffer.byteLength(chunk)
  const combined = Buffer.from(current + chunk)
  const tail = combined.length <= maxBytes ? combined : combined.subarray(combined.length - maxBytes)
  return {
    text: tail.toString('utf8').replace(/^\uFFFD/u, ''),
    totalBytes: nextTotal,
    truncated: nextTotal > maxBytes,
  }
}

export class DelegationRuntime {
  private readonly active = new Map<string, ActiveRun>()
  private pendingStarts = 0
  private disposed = false

  constructor(
    private readonly subprocess: SubprocessRuntimeLike,
    private readonly store: DelegateTaskStore,
    private readonly config: ResolvedConfig,
    private readonly onError: (error: Error) => void,
  ) {}

  publicConfig(): PublicConfig {
    return {
      maxConcurrentRuns: this.config.maxConcurrentRuns,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      maxLogBytes: this.config.maxLogBytes,
      retentionDays: this.config.retentionDays,
      defaultPermissionMode: this.config.defaultPermissionMode,
    }
  }

  list(ownerSessionId: string): TaskList {
    return { tasks: this.store.list(ownerSessionId), activeCount: this.active.size }
  }

  get(id: string, ownerSessionId: string): DelegateTask | undefined {
    const task = this.store.get(id)
    return task?.ownerSessionId === ownerSessionId ? task : undefined
  }

  async adapters(signal?: AbortSignal): Promise<AdapterDescriptor[]> {
    return Promise.all((Object.keys(this.config.adapters) as AdapterId[]).map(async (id) => {
      const adapter = this.config.adapters[id]
      const base = {
        id,
        label: labels[id],
        command: adapter.command,
        enabled: adapter.enabled,
        permissions: ['read-only', 'workspace-write'] as const,
        supportsModel: true,
        supportsProvider: id === 'pi',
        supportsReasoning: id !== 'codex',
      }
      if (!adapter.enabled) return { ...base, available: false, error: 'disabled by plugin configuration' }
      try {
        const executable = await this.subprocess.resolveExecutable(adapter.command, adapter.env, signal)
        return { ...base, available: true, executable }
      } catch (error) {
        return { ...base, available: false, error: messageOf(error) }
      }
    }))
  }

  async start(request: StartRequest): Promise<DelegateTask> {
    if (this.disposed) throw new Error('delegate runtime is stopping')
    const adapter = this.config.adapters[request.adapterId]
    if (!adapter.enabled) throw new Error(`${labels[request.adapterId]} is disabled`)
    const prompt = request.prompt.trim()
    if (prompt.length === 0) throw new Error('prompt must not be empty')
    if (prompt.length > 200_000) throw new Error('prompt must not exceed 200000 characters')
    if (this.active.size + this.pendingStarts >= this.config.maxConcurrentRuns) {
      throw new Error(`delegate concurrency limit reached (${String(this.config.maxConcurrentRuns)})`)
    }
    this.pendingStarts += 1
    try {
      const cwd = await this.resolveWorkspace(request.cwd)
    const executable = await this.subprocess.resolveExecutable(adapter.command, adapter.env)
    const permissionMode = request.permissionMode ?? this.config.defaultPermissionMode
    const invocation = buildInvocation({
      adapterId: request.adapterId,
      executable,
      prompt,
      cwd,
      permissionMode,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.provider === undefined ? {} : { provider: request.provider }),
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
    })
    const now = Date.now()
    const task: MutableTask = {
      id: `delegate-${randomUUID()}`,
      ownerSessionId: request.ownerSessionId,
      workspaceId: request.workspaceId,
      adapterId: request.adapterId,
      prompt,
      cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.provider === undefined ? {} : { provider: request.provider }),
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
      permissionMode,
      status: 'starting',
      command: commandPreview(invocation.argv),
      createdAt: now,
      updatedAt: now,
      stdout: '',
      stderr: '',
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      events: [],
      timedOut: false,
    }
    await this.store.put(task, true)

    const controller = new AbortController()
    let handle: ProcessHandle
    try {
      handle = this.subprocess.spawn({
        argv: invocation.argv,
        cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: this.config.terminateGraceMs,
        signal: controller.signal,
        env: { ...adapter.env },
      })
    } catch (error) {
      const finishedAt = Date.now()
      Object.assign(task, {
        status: 'failed',
        finishedAt,
        updatedAt: finishedAt,
        diagnostic: `spawn failed: ${messageOf(error)}`,
      })
      await this.store.put(task, true)
      return structuredClone(task)
    }

    task.pid = handle.pid
    task.status = 'running'
    task.startedAt = Date.now()
    task.updatedAt = task.startedAt
    await this.store.put(task, true)
    const active: ActiveRun = {
      task,
      handle,
      controller,
      timedOut: false,
      cancelled: false,
      settlement: Promise.resolve(),
    }
    this.active.set(task.id, active)
    active.settlement = this.settle(active, request.timeoutMs ?? this.config.defaultTimeoutMs)
      .catch((error: unknown) => { this.onError(error instanceof Error ? error : new Error(String(error))) })
      .finally(() => { this.active.delete(task.id) })
    return structuredClone(task)
    } finally {
      this.pendingStarts -= 1
    }
  }

  async clear(ownerSessionId: string): Promise<number> {
    return this.store.clearFinished(ownerSessionId)
  }

  async cancel(id: string, ownerSessionId: string): Promise<'requested' | 'already-finished'> {
    const task = this.store.get(id)
    if (task === undefined || task.ownerSessionId !== ownerSessionId) throw new Error('delegated task was not found in this session')
    const active = this.active.get(id)
    if (active === undefined) return 'already-finished'
    active.cancelled = true
    active.task.status = 'stopping'
    active.task.updatedAt = Date.now()
    await this.store.put(active.task, true)
    active.controller.abort(new Error('cancelled by user'))
    active.handle.terminate()
    return 'requested'
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const runs = [...this.active.values()]
    for (const run of runs) {
      run.cancelled = true
      run.controller.abort(new Error('plugin disposed'))
      run.handle.terminate()
    }
    await Promise.allSettled(runs.map(run => run.settlement))
  }

  private async resolveWorkspace(requested: string): Promise<string> {
    const canonical = await realpath(resolve(requested))
    if (!(await stat(canonical)).isDirectory()) throw new Error('workspace path is not a directory')
    if (this.config.allowedWorkspaceRoots.length > 0) {
      const roots = await Promise.all(this.config.allowedWorkspaceRoots.map(root => realpath(root)))
      if (!roots.some(root => isWithin(root, canonical))) {
        throw new Error('workspace is outside allowedWorkspaceRoots')
      }
    }
    return canonical
  }

  private async settle(run: ActiveRun, timeoutMs: number): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive safe integer')
    const parser = new ProtocolParser(run.task.adapterId, this.config.maxEventCount)
    const stdout = this.consume(run.handle.stdout, (chunk) => {
      parser.push(chunk)
      const appended = appendTail(run.task.stdout, chunk.toString('utf8'), run.task.stdoutBytes, this.config.maxLogBytes)
      run.task.stdout = appended.text
      run.task.stdoutBytes = appended.totalBytes
      run.task.stdoutTruncated = appended.truncated
      run.task.events = parser.snapshot().events
      run.task.updatedAt = Date.now()
      this.persistLater(run.task)
    })
    const stderr = this.consume(run.handle.stderr, (chunk) => {
      const appended = appendTail(run.task.stderr, chunk.toString('utf8'), run.task.stderrBytes, this.config.maxLogBytes)
      run.task.stderr = appended.text
      run.task.stderrBytes = appended.totalBytes
      run.task.stderrTruncated = appended.truncated
      run.task.updatedAt = Date.now()
      this.persistLater(run.task)
    })
    const timeout = setTimeout(() => {
      run.timedOut = true
      run.task.status = 'stopping'
      run.task.timedOut = true
      run.task.updatedAt = Date.now()
      run.controller.abort(new Error('delegate timeout'))
      run.handle.terminate()
      this.persistLater(run.task)
    }, timeoutMs)
    timeout.unref()

    const [outcomeResult, stdoutResult, stderrResult] = await Promise.allSettled([run.handle.done, stdout, stderr])
    clearTimeout(timeout)
    const quiet = await run.handle.waitForExit(AbortSignal.timeout(Math.max(1000, this.config.terminateGraceMs * 2)))
    const protocol = parser.finish()
    const finishedAt = Date.now()
    run.task.updatedAt = finishedAt
    run.task.finishedAt = finishedAt
    run.task.events = protocol.events
    run.task.timedOut = run.timedOut
    if (protocol.finalText !== undefined) run.task.finalText = protocol.finalText
    if (protocol.externalSessionId !== undefined) run.task.externalSessionId = protocol.externalSessionId

    const diagnostics = [...protocol.diagnostics]
    if (!quiet) diagnostics.push('process tree did not become quiescent within the teardown bound')
    if (stdoutResult.status === 'rejected') diagnostics.push(`stdout failed: ${messageOf(stdoutResult.reason)}`)
    if (stderrResult.status === 'rejected') diagnostics.push(`stderr failed: ${messageOf(stderrResult.reason)}`)
    if (outcomeResult.status === 'fulfilled') {
      run.task.exitCode = outcomeResult.value.exitCode
      run.task.signal = outcomeResult.value.signal
      run.task.status = run.timedOut
        ? 'timed-out'
        : run.cancelled
          ? 'killed'
          : outcomeResult.value.exitCode === 0
            ? 'completed'
            : 'failed'
    } else {
      run.task.status = run.timedOut ? 'timed-out' : run.cancelled ? 'killed' : 'failed'
      diagnostics.push(`process failed: ${messageOf(outcomeResult.reason)}`)
    }
    if (diagnostics.length > 0) run.task.diagnostic = diagnostics.join('\n')
    await this.store.put(run.task, true)
  }

  private async consume(stream: Readable | undefined, onChunk: (chunk: Buffer) => void): Promise<void> {
    if (stream === undefined) throw new Error('subprocess provider did not expose a piped stream')
    for await (const chunk of stream) onChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }

  private persistLater(task: DelegateTask): void {
    void this.store.put(task).catch((error: unknown) => {
      this.onError(error instanceof Error ? error : new Error(String(error)))
    })
  }
}
