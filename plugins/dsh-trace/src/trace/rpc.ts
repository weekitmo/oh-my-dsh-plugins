import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { TraceSqliteStore } from './store.ts'

const MAX_PAGE_SIZE = 200

function ok<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function fail(code: string, message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export async function handleTraceRpc(
  store: TraceSqliteStore,
  endpoint: string,
  payload: unknown,
  resolveWorkspaceId: (sessionId: string) => string | undefined = () => undefined,
): Promise<ConnectionRpcResult<unknown>> {
  const body = object(payload)
  if (endpoint === 'requests.list') {
    if (body === undefined) return fail('dsh-trace/invalid-request', 'list payload must be an object')
    const sessionId = body['sessionId']
    const before = body['before']
    const rawLimit = body['limit'] ?? 80
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return fail('dsh-trace/invalid-request', 'sessionId must be a non-empty string')
    }
    const cursor = object(before)
    if (before !== undefined && (
      cursor === undefined
      || typeof cursor['startedAt'] !== 'number'
      || !Number.isFinite(cursor['startedAt'])
      || typeof cursor['id'] !== 'string'
      || cursor['id'].length === 0
    )) {
      return fail('dsh-trace/invalid-request', 'before must contain a finite startedAt and non-empty id')
    }
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_PAGE_SIZE) {
      return fail('dsh-trace/invalid-request', `limit must be an integer from 1 through ${String(MAX_PAGE_SIZE)}`)
    }
    const workspaceId = resolveWorkspaceId(sessionId)
    return ok(await store.list({
      sessionId,
      limit: rawLimit,
      ...workspaceId === undefined ? {} : { workspaceId },
      ...cursor === undefined ? {} : { before: { startedAt: cursor['startedAt'] as number, id: cursor['id'] as string } },
    }))
  }
  if (endpoint === 'requests.get') {
    const id = body?.['id']
    const sessionId = body?.['sessionId']
    if (typeof id !== 'string' || id.length === 0) {
      return fail('dsh-trace/invalid-request', 'id must be a non-empty string')
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return fail('dsh-trace/invalid-request', 'sessionId must be a non-empty string')
    }
    const workspaceId = resolveWorkspaceId(sessionId)
    const record = await store.get(id, {
      sessionId,
      ...workspaceId === undefined ? {} : { workspaceId },
    })
    return record === undefined
      ? fail('dsh-trace/not-found', `request ${JSON.stringify(id)} was not found in this session`)
      : ok(record)
  }
  if (endpoint === 'requests.clear') {
    const sessionId = body?.['sessionId']
    if (body?.['confirm'] !== true) {
      return fail('dsh-trace/invalid-request', 'clear requires confirm: true')
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return fail('dsh-trace/invalid-request', 'sessionId must be a non-empty string')
    }
    const workspaceId = resolveWorkspaceId(sessionId)
    await store.clear({
      sessionId,
      ...workspaceId === undefined ? {} : { workspaceId },
    })
    return ok({ cleared: true })
  }
  return fail('dsh-trace/not-found', `unknown endpoint ${JSON.stringify(endpoint)}`)
}
