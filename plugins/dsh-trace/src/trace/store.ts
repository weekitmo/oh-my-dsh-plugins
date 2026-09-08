import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  TraceListQuery, TraceListResult, TraceRequestRecord, TraceRequestSummary, TraceScope,
} from './types.ts'
import { requestSummary } from './types.ts'

const SCHEMA_VERSION = 1
const APPLICATION_ID = 0x44534854
const DEFAULT_BUSY_TIMEOUT_MS = 5_000

export interface TraceStoreOptions {
  readonly path: string
  readonly legacyJsonlPath?: string
  readonly retentionMs: number
  readonly maxRecords: number
  readonly maxStorageBytes: number
  readonly busyTimeoutMs?: number
  readonly now?: () => number
  readonly resolveWorkspaceId?: (sessionId: string) => string | undefined
}

interface SummaryRow {
  readonly id: string
  readonly logical_request_id: string
  readonly attempt: number
  readonly started_at: number
  readonly completed_at: number
  readonly duration_ms: number
  readonly provider: string
  readonly model: string
  readonly workspace_id: string | null
  readonly session_id: string | null
  readonly purpose: string | null
  readonly method: string
  readonly url: string
  readonly response_status: number | null
  readonly error: string | null
  readonly aborted: number | null
  readonly truncated: number
}

function isRecord(value: unknown): value is TraceRequestRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Partial<TraceRequestRecord>
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.logicalRequestId === 'string' && record.logicalRequestId.length > 0
    && Number.isSafeInteger(record.attempt) && (record.attempt ?? 0) > 0
    && Number.isSafeInteger(record.startedAt) && (record.startedAt ?? -1) >= 0
    && Number.isSafeInteger(record.completedAt) && (record.completedAt ?? -1) >= 0
    && Number.isSafeInteger(record.durationMs) && (record.durationMs ?? -1) >= 0
    && typeof record.provider === 'string'
    && typeof record.model === 'string'
    && (record.workspaceId === undefined || typeof record.workspaceId === 'string' && record.workspaceId.length > 0)
    && (record.sessionId === undefined || typeof record.sessionId === 'string' && record.sessionId.length > 0)
    && (record.purpose === undefined || typeof record.purpose === 'string')
    && typeof record.method === 'string'
    && typeof record.url === 'string'
    && typeof record.requestHeaders === 'object'
    && record.requestHeaders !== null
    && !Array.isArray(record.requestHeaders)
    && (record.responseStatus === undefined
      || Number.isSafeInteger(record.responseStatus) && record.responseStatus >= 100 && record.responseStatus <= 599)
    && (record.responseStatusText === undefined || typeof record.responseStatusText === 'string')
    && (record.responseUrl === undefined || typeof record.responseUrl === 'string')
    && (record.responseHeaders === undefined
      || typeof record.responseHeaders === 'object'
        && record.responseHeaders !== null
        && !Array.isArray(record.responseHeaders))
    && (record.error === undefined || typeof record.error === 'string')
    && (record.aborted === undefined || typeof record.aborted === 'boolean')
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`dsh-trace: ${field} must be a positive safe integer`)
  }
  return value
}

function sqliteInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`dsh-trace: SQLite returned an invalid ${field}`)
  }
  return value
}

function sqliteString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`dsh-trace: SQLite returned an invalid ${field}`)
  return value
}

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dsh-trace: SQLite returned an invalid row')
  }
  return value as Record<string, unknown>
}

function summaryRow(value: unknown): Omit<TraceRequestSummary, 'expiresAt'> {
  const row = rowObject(value) as unknown as SummaryRow
  return {
    id: sqliteString(row.id, 'id'),
    logicalRequestId: sqliteString(row.logical_request_id, 'logical_request_id'),
    attempt: sqliteInteger(row.attempt, 'attempt'),
    startedAt: sqliteInteger(row.started_at, 'started_at'),
    completedAt: sqliteInteger(row.completed_at, 'completed_at'),
    durationMs: sqliteInteger(row.duration_ms, 'duration_ms'),
    provider: sqliteString(row.provider, 'provider'),
    model: sqliteString(row.model, 'model'),
    ...row.workspace_id === null ? {} : { workspaceId: sqliteString(row.workspace_id, 'workspace_id') },
    ...row.session_id === null ? {} : { sessionId: sqliteString(row.session_id, 'session_id') },
    ...row.purpose === null ? {} : { purpose: sqliteString(row.purpose, 'purpose') },
    method: sqliteString(row.method, 'method'),
    url: sqliteString(row.url, 'url'),
    ...row.response_status === null ? {} : { responseStatus: sqliteInteger(row.response_status, 'response_status') },
    ...row.error === null ? {} : { error: sqliteString(row.error, 'error') },
    ...row.aborted === null ? {} : { aborted: sqliteInteger(row.aborted, 'aborted') === 1 },
    truncated: sqliteInteger(row.truncated, 'truncated') === 1,
  }
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const file = await open(path, 'wx', 0o600)
    await file.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

let sqliteModule: Promise<typeof import('node:sqlite')> | undefined

function loadNodeSqlite(): Promise<typeof import('node:sqlite')> {
  sqliteModule ??= importNodeSqlite()
  return sqliteModule
}

async function importNodeSqlite(): Promise<typeof import('node:sqlite')> {
  const emitWarning = Reflect.get(process, 'emitWarning')
  const filteredEmitWarning = (warning: string | Error, ...args: unknown[]): void => {
    const message = warning instanceof Error ? warning.message : warning
    const first = args[0]
    const type = warning instanceof Error
      ? warning.name
      : typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'type' in first
          ? first.type
          : undefined
    if (message === 'SQLite is an experimental feature and might change at any time'
      && type === 'ExperimentalWarning') return
    Reflect.apply(emitWarning, process, [warning, ...args])
  }
  Reflect.set(process, 'emitWarning', filteredEmitWarning)
  try {
    return await import('node:sqlite')
  } finally {
    Reflect.set(process, 'emitWarning', emitWarning)
  }
}

export class TraceSqliteStore {
  private readonly now: () => number
  private readonly busyTimeoutMs: number
  private retentionMs: number
  private database: DatabaseSync | undefined
  private insertStatement: StatementSync | undefined
  private insertIgnoreStatement: StatementSync | undefined
  private writes = Promise.resolve()

  constructor(private readonly options: TraceStoreOptions) {
    this.now = options.now ?? Date.now
    this.retentionMs = positiveInteger(options.retentionMs, 'retentionMs')
    positiveInteger(options.maxRecords, 'maxRecords')
    positiveInteger(options.maxStorageBytes, 'maxStorageBytes')
    this.busyTimeoutMs = positiveInteger(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS, 'busyTimeoutMs')
  }

  async initialize(): Promise<void> {
    if (this.database !== undefined) return
    await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.options.path), 0o700)
    await createDatabaseFile(this.options.path)
    await chmod(this.options.path, 0o600)
    const { DatabaseSync } = await loadNodeSqlite()
    const db = new DatabaseSync(this.options.path, { timeout: 0 })
    try {
      await this.configure(db)
      this.database = db
      const insertSql = `
        INSERT INTO requests (
          id, logical_request_id, attempt, started_at, completed_at, duration_ms,
          provider, model, workspace_id, session_id, purpose, method, url,
          response_status, error, aborted, truncated, record_json, storage_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      this.insertStatement = db.prepare(insertSql)
      this.insertIgnoreStatement = db.prepare(insertSql.replace('INSERT INTO', 'INSERT OR IGNORE INTO'))
      await this.migrateLegacyJsonl()
      await this.cleanup()
    } catch (error) {
      this.database = undefined
      this.insertStatement = undefined
      this.insertIgnoreStatement = undefined
      db.close()
      throw error
    }
  }

  async append(record: TraceRequestRecord): Promise<void> {
    if (record.sessionId === undefined) return
    await this.writeTransaction((db) => {
      this.insert(record)
      this.cleanupInTransaction(db)
    })
  }

  async list(query: TraceListQuery): Promise<TraceListResult> {
    const db = this.requireDatabase()
    const conditions = ['session_id = ?', 'started_at >= ?']
    const bindings: Array<string | number> = [query.sessionId, this.now() - this.retentionMs]
    if (query.workspaceId === undefined) conditions.push('workspace_id IS NULL')
    else {
      conditions.push('(workspace_id = ? OR workspace_id IS NULL)')
      bindings.push(query.workspaceId)
    }
    if (query.before !== undefined) {
      conditions.push('(started_at < ? OR (started_at = ? AND id COLLATE BINARY < ?))')
      bindings.push(query.before.startedAt, query.before.startedAt, query.before.id)
    }
    const rows = db.prepare(`
      SELECT
        id, logical_request_id, attempt, started_at, completed_at, duration_ms,
        provider, model, workspace_id, session_id, purpose, method, url,
        response_status, error, aborted, truncated
      FROM requests
      WHERE ${conditions.join(' AND ')}
      ORDER BY started_at DESC, id COLLATE BINARY DESC
      LIMIT ?
    `).all(...bindings, query.limit + 1)
    return {
      requests: rows.slice(0, query.limit).map((row) => {
        const summary = summaryRow(row)
        return {
          ...summary,
          expiresAt: Math.min(Number.MAX_SAFE_INTEGER, summary.startedAt + this.retentionMs),
        }
      }),
      hasMore: rows.length > query.limit,
    }
  }

  async get(id: string, scope: TraceScope): Promise<TraceRequestRecord | undefined> {
    const db = this.requireDatabase()
    const conditions = ['id = ?', 'session_id = ?', 'started_at >= ?']
    const bindings: Array<string | number> = [id, scope.sessionId, this.now() - this.retentionMs]
    if (scope.workspaceId === undefined) conditions.push('workspace_id IS NULL')
    else {
      conditions.push('(workspace_id = ? OR workspace_id IS NULL)')
      bindings.push(scope.workspaceId)
    }
    const value = db.prepare(`
      SELECT record_json FROM requests WHERE ${conditions.join(' AND ')}
    `).get(...bindings)
    if (value === undefined) return undefined
    try {
      const parsed = JSON.parse(sqliteString(rowObject(value)['record_json'], 'record_json')) as unknown
      return isRecord(parsed) && parsed.id === id ? parsed : undefined
    } catch (error) {
      if (error instanceof SyntaxError) return undefined
      throw error
    }
  }

  async setRetentionMs(retentionMs: number): Promise<void> {
    const resolved = positiveInteger(retentionMs, 'retentionMs')
    if (resolved === this.retentionMs) return
    this.retentionMs = resolved
    await this.cleanup()
  }

  async cleanup(): Promise<void> {
    await this.writeTransaction(db => { this.cleanupInTransaction(db) })
  }

  async clear(scope: TraceScope): Promise<void> {
    await this.writeTransaction((db) => {
      if (scope.workspaceId === undefined) {
        db.prepare('DELETE FROM requests WHERE session_id = ? AND workspace_id IS NULL').run(scope.sessionId)
        return
      }
      db.prepare(`
        DELETE FROM requests
        WHERE session_id = ? AND (workspace_id = ? OR workspace_id IS NULL)
      `).run(scope.sessionId, scope.workspaceId)
    })
  }

  async close(): Promise<void> {
    await this.writes
    const db = this.database
    this.database = undefined
    this.insertStatement = undefined
    this.insertIgnoreStatement = undefined
    db?.close()
  }

  private async configure(db: DatabaseSync): Promise<void> {
    db.exec('PRAGMA trusted_schema = OFF')
    db.exec('PRAGMA foreign_keys = ON')
    const deadline = performance.now() + this.busyTimeoutMs
    let journal: Record<string, unknown>
    while (true) {
      try {
        journal = rowObject(db.prepare('PRAGMA journal_mode = WAL').get())
        break
      } catch (error) {
        const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()))
        if (!this.isBusy(error) || remainingMs === 0) throw error
        await delay(Math.min(25, remainingMs))
      }
    }
    if (sqliteString(journal['journal_mode'], 'journal_mode').toLowerCase() !== 'wal') {
      throw new Error('dsh-trace: SQLite could not enable WAL journal mode')
    }
    db.exec('PRAGMA synchronous = FULL')
    await this.beginImmediate(db)
    try {
      const version = sqliteInteger(rowObject(db.prepare('PRAGMA user_version').get())['user_version'], 'user_version')
      const applicationId = sqliteInteger(
        rowObject(db.prepare('PRAGMA application_id').get())['application_id'],
        'application_id',
      )
      const tableCount = sqliteInteger(rowObject(db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).get())['count'], 'table count')
      if (version === 0 && (applicationId !== 0 || tableCount !== 0)) {
        throw new Error(`dsh-trace: SQLite database at ${JSON.stringify(this.options.path)} has an unversioned schema`)
      }
      if (version !== 0 && version !== SCHEMA_VERSION) {
        throw new Error(
          `dsh-trace: SQLite schema version ${String(version)} is incompatible with ${String(SCHEMA_VERSION)}`,
        )
      }
      if (version !== 0 && applicationId !== APPLICATION_ID) {
        throw new Error(`dsh-trace: SQLite database at ${JSON.stringify(this.options.path)} belongs to another application`)
      }
      if (version === 0) {
        db.exec(`
          CREATE TABLE requests (
            id TEXT PRIMARY KEY,
            logical_request_id TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            completed_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            workspace_id TEXT,
            session_id TEXT,
            purpose TEXT,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            response_status INTEGER,
            error TEXT,
            aborted INTEGER,
            truncated INTEGER NOT NULL,
            record_json TEXT NOT NULL,
            storage_bytes INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX requests_workspace_session_cursor
            ON requests(workspace_id, session_id, started_at DESC, id DESC);
          CREATE INDEX requests_session_cursor
            ON requests(session_id, started_at DESC, id DESC);
          CREATE INDEX requests_started_at ON requests(started_at);
          PRAGMA application_id = ${String(APPLICATION_ID)};
          PRAGMA user_version = ${String(SCHEMA_VERSION)};
        `)
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS trace_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          record_count INTEGER NOT NULL CHECK (record_count >= 0),
          storage_bytes INTEGER NOT NULL CHECK (storage_bytes >= 0)
        ) STRICT;
        INSERT OR IGNORE INTO trace_state (singleton, record_count, storage_bytes)
          SELECT 1, COUNT(*), COALESCE(SUM(storage_bytes), 0) FROM requests;
        CREATE TRIGGER IF NOT EXISTS requests_state_insert
          AFTER INSERT ON requests BEGIN
            UPDATE trace_state
            SET record_count = record_count + 1,
                storage_bytes = storage_bytes + NEW.storage_bytes
            WHERE singleton = 1;
          END;
        CREATE TRIGGER IF NOT EXISTS requests_state_delete
          AFTER DELETE ON requests BEGIN
            UPDATE trace_state
            SET record_count = record_count - 1,
                storage_bytes = storage_bytes - OLD.storage_bytes
            WHERE singleton = 1;
          END;
      `)
      db.exec('COMMIT')
    } catch (error) {
      this.rollback(db)
      throw error
    }
  }

  private insert(record: TraceRequestRecord, ignoreConflict = false): void {
    const statement = ignoreConflict ? this.insertIgnoreStatement : this.insertStatement
    if (statement === undefined) throw new Error('dsh-trace: SQLite store is not initialized')
    const summary = requestSummary(record)
    const json = JSON.stringify(record)
    statement.run(
      record.id,
      record.logicalRequestId,
      record.attempt,
      record.startedAt,
      record.completedAt,
      record.durationMs,
      record.provider,
      record.model,
      record.workspaceId ?? null,
      record.sessionId ?? null,
      record.purpose ?? null,
      record.method,
      record.url,
      record.responseStatus ?? null,
      record.error ?? null,
      record.aborted === undefined ? null : record.aborted ? 1 : 0,
      summary.truncated ? 1 : 0,
      json,
      Buffer.byteLength(json),
    )
  }

  private cleanupInTransaction(db: DatabaseSync): void {
    db.prepare('DELETE FROM requests WHERE started_at < ?').run(this.now() - this.retentionMs)
    const state = rowObject(db.prepare(`
      SELECT record_count, storage_bytes FROM trace_state WHERE singleton = 1
    `).get())
    let count = sqliteInteger(state['record_count'], 'record_count')
    let bytes = sqliteInteger(state['storage_bytes'], 'storage_bytes')
    if (count <= this.options.maxRecords && bytes <= this.options.maxStorageBytes) return

    const rows = db.prepare(`
      SELECT id, storage_bytes FROM requests
      ORDER BY started_at DESC, id COLLATE BINARY DESC
    `).all()
    const remove = db.prepare('DELETE FROM requests WHERE id = ?')
    count = 0
    bytes = 0
    for (const value of rows) {
      const row = rowObject(value)
      const id = sqliteString(row['id'], 'id')
      const size = sqliteInteger(row['storage_bytes'], 'storage_bytes')
      if (count >= this.options.maxRecords || bytes + size > this.options.maxStorageBytes) {
        remove.run(id)
        continue
      }
      count += 1
      bytes += size
    }
  }

  private async migrateLegacyJsonl(): Promise<void> {
    const path = this.options.legacyJsonlPath
    if (path === undefined) return
    let batch: TraceRequestRecord[] = []
    try {
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
      for await (const line of lines) {
        if (line.trim().length === 0) continue
        try {
          const value = JSON.parse(line) as unknown
          if (!isRecord(value)) continue
          batch.push(value)
          if (batch.length < 100) continue
          await this.insertLegacyBatch(batch)
          batch = []
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          // A damaged legacy line does not hide later valid records.
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (batch.length > 0) await this.insertLegacyBatch(batch)
    await this.cleanup()
    try {
      await rename(path, `${path}.migrated-${String(this.now())}-${String(process.pid)}-${randomUUID()}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async insertLegacyBatch(records: readonly TraceRequestRecord[]): Promise<void> {
    await this.writeTransaction(() => {
      for (const original of records) {
        if (original.sessionId === undefined) continue
        const workspaceId = original.workspaceId ?? this.options.resolveWorkspaceId?.(original.sessionId)
        this.insert(workspaceId === undefined ? original : { ...original, workspaceId }, true)
      }
    })
  }

  private writeTransaction(operation: (db: DatabaseSync) => void): Promise<void> {
    const execute = async (): Promise<void> => {
      const db = this.requireDatabase()
      await this.beginImmediate(db)
      try {
        operation(db)
        db.exec('COMMIT')
      } catch (error) {
        this.rollback(db)
        throw error
      }
    }
    const result = this.writes.then(execute, execute)
    this.writes = result.then(() => undefined, () => undefined)
    return result
  }

  private async beginImmediate(db: DatabaseSync): Promise<void> {
    const deadline = performance.now() + this.busyTimeoutMs
    while (true) {
      try {
        db.exec('BEGIN IMMEDIATE')
        return
      } catch (error) {
        const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()))
        if (!this.isBusy(error) || remainingMs === 0) throw error
        await delay(Math.min(25, remainingMs))
      }
    }
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('dsh-trace: SQLite store is not initialized')
    return this.database
  }

  private isBusy(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && Reflect.get(error, 'errcode') === 5
  }

  private rollback(db: DatabaseSync): void {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the original transaction failure.
    }
  }
}
