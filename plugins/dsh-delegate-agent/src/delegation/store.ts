import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DelegateTask, TaskStatus } from '../types.ts'

const LIVE_STATUSES = new Set<TaskStatus>(['starting', 'running', 'stopping'])

function cloneTask(task: DelegateTask): DelegateTask {
  return structuredClone(task)
}

export class DelegateTaskStore {
  private readonly tasks = new Map<string, DelegateTask>()
  private writeChain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly directory: string,
    private readonly retentionDays: number,
    private readonly onError: (error: Error) => void = () => {},
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    try {
      const decoded = JSON.parse(await readFile(this.path(), 'utf8')) as unknown
      if (!Array.isArray(decoded)) throw new Error('task store root must be an array')
      const now = Date.now()
      for (const value of decoded) {
        if (typeof value !== 'object' || value === null) continue
        const task = value as DelegateTask
        if (typeof task.id !== 'string' || typeof task.createdAt !== 'number') continue
        this.tasks.set(task.id, LIVE_STATUSES.has(task.status) ? {
          ...task,
          status: 'interrupted',
          finishedAt: now,
          updatedAt: now,
          diagnostic: 'DSH stopped before this delegated task settled',
        } : task)
      }
      this.prune(now)
      await this.persist()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  list(ownerSessionId: string): DelegateTask[] {
    if (this.prune(Date.now()) > 0) this.schedulePersist()
    return [...this.tasks.values()]
      .filter(task => task.ownerSessionId === ownerSessionId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(cloneTask)
  }

  get(id: string): DelegateTask | undefined {
    const task = this.tasks.get(id)
    return task === undefined ? undefined : cloneTask(task)
  }

  async put(task: DelegateTask, immediate = false): Promise<void> {
    this.tasks.set(task.id, cloneTask(task))
    this.prune(Date.now())
    if (immediate) await this.persist()
    else this.schedulePersist()
  }

  async clearFinished(ownerSessionId: string): Promise<number> {
    let removed = 0
    for (const [id, task] of this.tasks) {
      if (task.ownerSessionId !== ownerSessionId || LIVE_STATUSES.has(task.status)) continue
      this.tasks.delete(id)
      removed += 1
    }
    if (removed > 0) await this.persist()
    return removed
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.persist()
    await this.writeChain
  }

  private path(): string {
    return join(this.directory, 'tasks.json')
  }

  private prune(now: number): number {
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const [id, task] of this.tasks) {
      if (task.finishedAt === undefined || task.finishedAt >= cutoff) continue
      this.tasks.delete(id)
      removed += 1
    }
    return removed
  }

  private schedulePersist(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.persist().catch((error: unknown) => {
        this.onError(error instanceof Error ? error : new Error(String(error)))
      })
    }, 100)
    this.timer.unref()
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify([...this.tasks.values()], null, 2)
    const write = this.writeChain.then(async () => {
      const temporary = join(this.directory, `.tasks-${randomUUID()}.tmp`)
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
      try {
        await rename(temporary, this.path())
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.writeChain = write.catch(() => {})
    await write
  }
}
