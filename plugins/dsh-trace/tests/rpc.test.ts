import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { handleTraceRpc } from '../src/trace/rpc.ts'
import { TraceSqliteStore } from '../src/trace/store.ts'
import { record } from './helpers.ts'

async function fixture() {
  const now = Date.UTC(2026, 7, 31, 12)
  const store = new TraceSqliteStore({
    path: join(tmpdir(), `dsh-trace-${randomUUID()}`, 'requests.sqlite'),
    retentionMs: 3 * 24 * 60 * 60 * 1000,
    maxRecords: 100,
    maxStorageBytes: 1024 * 1024,
    now: () => now,
  })
  await store.initialize()
  await store.append(record('request-a', now, { workspaceId: 'workspace-a', sessionId: 'session-a' }))
  await store.append(record('request-b', now + 1, { workspaceId: 'workspace-b', sessionId: 'session-b' }))
  return store
}

const workspaceForSession = (sessionId: string): string | undefined => ({
  'session-a': 'workspace-a',
  'session-b': 'workspace-b',
})[sessionId]

test('validates scoped list payloads and returns summaries rather than full bodies', async () => {
  const store = await fixture()
  try {
    assert.equal((await handleTraceRpc(store, 'requests.list', { limit: 20 }, workspaceForSession)).ok, false)
    assert.equal((await handleTraceRpc(store, 'requests.list', { sessionId: 'session-a', limit: 0 }, workspaceForSession)).ok, false)
    assert.equal((await handleTraceRpc(store, 'requests.list', {
      sessionId: 'session-a', before: 123, limit: 20,
    }, workspaceForSession)).ok, false)
    const answer = await handleTraceRpc(store, 'requests.list', {
      sessionId: 'session-a', limit: 20,
    }, workspaceForSession)
    assert.equal(answer.ok, true)
    if (!answer.ok) return
    const value = answer.value as { requests: Array<Record<string, unknown>> }
    assert.equal(value.requests.length, 1)
    assert.equal(value.requests[0]?.['id'], 'request-a')
    assert.equal('requestBody' in (value.requests[0] ?? {}), false)
  } finally {
    await store.close()
  }
})

test('scopes details and clear to the requested session', async () => {
  const store = await fixture()
  try {
    assert.equal((await handleTraceRpc(store, 'requests.get', {
      id: 'request-a', sessionId: 'session-a',
    }, workspaceForSession)).ok, true)
    assert.equal((await handleTraceRpc(store, 'requests.get', {
      id: 'request-a', sessionId: 'session-b',
    }, workspaceForSession)).ok, false)
    assert.equal((await handleTraceRpc(store, 'requests.get', { id: 'request-a' }, workspaceForSession)).ok, false)
    assert.equal((await handleTraceRpc(store, 'requests.clear', {
      sessionId: 'session-a',
    }, workspaceForSession)).ok, false)
    assert.deepEqual(await handleTraceRpc(store, 'requests.clear', {
      sessionId: 'session-a', confirm: true,
    }, workspaceForSession), {
      ok: true,
      value: { cleared: true },
    })
    assert.equal((await handleTraceRpc(store, 'requests.get', {
      id: 'request-a', sessionId: 'session-a',
    }, workspaceForSession)).ok, false)
    assert.equal((await handleTraceRpc(store, 'requests.get', {
      id: 'request-b', sessionId: 'session-b',
    }, workspaceForSession)).ok, true)
  } finally {
    await store.close()
  }
})
