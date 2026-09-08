import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  TraceListCursor, TraceListResult,
  TraceRequestRecord,
} from '../trace/types.ts'

export interface TraceClient {
  list(sessionId: string, before?: TraceListCursor, signal?: AbortSignal): Promise<TraceListResult>
  get(sessionId: string, id: string, signal?: AbortSignal): Promise<TraceRequestRecord>
  clear(sessionId: string, signal?: AbortSignal): Promise<void>
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function rpcValue(result: { ok: true; value: unknown } | { ok: false; error: { message: string } }): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseTraceListResult(value: unknown): TraceListResult {
  const data = object(value)
  if (data === undefined || !Array.isArray(data['requests']) || typeof data['hasMore'] !== 'boolean') {
    throw new Error('dsh-trace returned an invalid request list')
  }
  for (const request of data['requests']) {
    const row = object(request)
    if (row === undefined
      || typeof row['id'] !== 'string'
      || typeof row['logicalRequestId'] !== 'string'
      || !Number.isSafeInteger(row['attempt'])
      || !finiteNumber(row['startedAt'])
      || !finiteNumber(row['completedAt'])
      || !finiteNumber(row['expiresAt'])
      || !finiteNumber(row['durationMs'])
      || typeof row['provider'] !== 'string'
      || typeof row['model'] !== 'string'
      || typeof row['method'] !== 'string'
      || typeof row['url'] !== 'string'
      || typeof row['truncated'] !== 'boolean') {
      throw new Error('dsh-trace returned an invalid request summary')
    }
  }
  return value as TraceListResult
}

export function parseTraceRequestRecord(value: unknown): TraceRequestRecord {
  const record = object(value)
  if (record === undefined
    || typeof record['id'] !== 'string'
    || typeof record['logicalRequestId'] !== 'string'
    || !Number.isSafeInteger(record['attempt'])
    || !finiteNumber(record['startedAt'])
    || !finiteNumber(record['completedAt'])
    || !finiteNumber(record['durationMs'])
    || typeof record['provider'] !== 'string'
    || typeof record['model'] !== 'string'
    || typeof record['method'] !== 'string'
    || typeof record['url'] !== 'string'
    || object(record['requestHeaders']) === undefined) {
    throw new Error('dsh-trace returned an invalid request record')
  }
  return value as unknown as TraceRequestRecord
}

export function createTraceClient(ctx: Context): TraceClient {
  // Host and Client faces are typechecked together in this standalone package;
  // select the browser half explicitly where both augment ctx.connection.
  const connection = ctx.connection as unknown as ConnectionHandle
  return {
    async list(sessionId, before, signal) {
      const result = await connection.rpc.call('/dsh-trace', 'requests.list', {
        sessionId,
        limit: 80,
        ...before === undefined ? {} : { before },
      }, signal)
      return parseTraceListResult(rpcValue(result))
    },
    async get(sessionId, id, signal) {
      return parseTraceRequestRecord(rpcValue(
        await connection.rpc.call('/dsh-trace', 'requests.get', { sessionId, id }, signal),
      ))
    },
    async clear(sessionId, signal) {
      rpcValue(await connection.rpc.call('/dsh-trace', 'requests.clear', { sessionId, confirm: true }, signal))
    },
  }
}
