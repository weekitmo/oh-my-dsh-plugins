import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { TRACE_RPC_ENDPOINTS, traceRpcAddress, traceRpcPath } from '../src/rpc-contract.ts'
import { registerTraceRoutes } from '../src/trace/routes.ts'
import { TraceSqliteStore } from '../src/trace/store.ts'
import { record } from './helpers.ts'

interface RegisteredRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

/** Minimal host context exposing the Connection Fetch registry and Cordis effects. */
function hostHarness() {
  const routes: RegisteredRoute[] = []
  const ctx = {
    connection: {
      fetch: {
        register(route: RegisteredRoute): () => Promise<void> {
          if (routes.some(candidate => candidate.path === route.path)) {
            throw new Error(`duplicate route ${route.path}`)
          }
          routes.push(route)
          return () => {
            routes.splice(routes.indexOf(route), 1)
            return Promise.resolve()
          }
        },
      },
    },
    effect(callback: () => (() => void) | void): () => Promise<void> {
      const dispose = callback()
      return () => {
        dispose?.()
        return Promise.resolve()
      }
    },
  }
  return { ctx, routes }
}

async function storeFixture() {
  const now = Date.UTC(2026, 8, 17, 12)
  const store = new TraceSqliteStore({
    path: join(tmpdir(), `dsh-trace-routes-${randomUUID()}`, 'requests.sqlite'),
    retentionMs: 24 * 60 * 60 * 1000,
    maxRecords: 100,
    maxStorageBytes: 1024 * 1024,
    now: () => now,
  })
  await store.initialize()
  await store.append(record('request-a', now, { workspaceId: 'workspace-a', sessionId: 'session-a' }))
  return store
}

const workspaceForSession = (sessionId: string): string | undefined => ({
  'session-a': 'workspace-a',
})[sessionId]

function post(path: string, body: unknown): Request {
  return new Request(`http://dsh.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Same envelope the browser half posts: the method addresses `<namespace>/<endpoint>`. */
function envelope(address: string, payload: unknown, rpcId = 'rpc-1'): Record<string, unknown> {
  return { type: 'client-request', rpcId, method: address, payload }
}

test('registers one buffered POST route per endpoint on the shared channel', async () => {
  const store = await storeFixture()
  const { ctx, routes } = hostHarness()
  try {
    const dispose = registerTraceRoutes(ctx as never, store, workspaceForSession)
    assert.deepEqual(routes.map(route => route.path), TRACE_RPC_ENDPOINTS.map(traceRpcPath))
    assert.deepEqual(routes.map(route => route.path), [
      '/api/dsh-trace/requests.list',
      '/api/dsh-trace/requests.get',
      '/api/dsh-trace/requests.clear',
    ])
    for (const route of routes) {
      assert.deepEqual(route.methods, ['POST'])
      assert.equal(route.requestBody, 'buffered')
    }
    await dispose()
    assert.deepEqual(routes, [])
  } finally {
    await store.close()
  }
})

test('answers a list request with the correlated server-response envelope', async () => {
  const store = await storeFixture()
  const { ctx, routes } = hostHarness()
  try {
    registerTraceRoutes(ctx as never, store, workspaceForSession)
    const route = routes.find(candidate => candidate.path === traceRpcPath('requests.list'))
    assert.notEqual(route, undefined)
    const response = await route!.fetch(post(traceRpcPath('requests.list'), envelope(traceRpcAddress('requests.list'), {
      sessionId: 'session-a',
      limit: 20,
    })))
    assert.equal(response.status, 200)
    const body = await response.json() as {
      type: string
      rpcId: string
      result: { ok: boolean, value: { requests: Array<Record<string, unknown>>, hasMore: boolean } }
    }
    assert.equal(body.type, 'server-response')
    assert.equal(body.rpcId, 'rpc-1')
    assert.equal(body.result.ok, true)
    assert.deepEqual(body.result.value.requests.map(request => request['id']), ['request-a'])
    assert.equal(body.result.value.hasMore, false)
  } finally {
    await store.close()
  }
})

test('rejects a malformed body and a mismatched method without dispatching', async () => {
  const store = await storeFixture()
  const { ctx, routes } = hostHarness()
  try {
    registerTraceRoutes(ctx as never, store, workspaceForSession)
    const route = routes.find(candidate => candidate.path === traceRpcPath('requests.list'))!

    const notJson = await route.fetch(new Request(`http://dsh.internal${traceRpcPath('requests.list')}`, {
      method: 'POST',
      body: 'not json',
    }))
    assert.equal(notJson.status, 400)

    const wrongMethod = await route.fetch(post(
      traceRpcPath('requests.list'),
      envelope(traceRpcAddress('requests.clear'), { sessionId: 'session-a', confirm: true }, 'rpc-2'),
    ))
    assert.equal(wrongMethod.status, 200)
    assert.deepEqual(await wrongMethod.json(), {
      type: 'server-response',
      rpcId: 'rpc-2',
      result: {
        ok: false,
        error: {
          code: 'gateway/bad-request',
          message: 'method "dsh-trace/requests.clear" does not match endpoint "dsh-trace/requests.list"',
          details: {},
        },
      },
    })

    const notAnEnvelope = await route.fetch(post(traceRpcPath('requests.list'), { sessionId: 'session-a' }))
    assert.equal(notAnEnvelope.status, 200)
    assert.deepEqual(await notAnEnvelope.json(), {
      type: 'server-response',
      rpcId: 'invalid-request',
      result: {
        ok: false,
        error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} },
      },
    })
  } finally {
    await store.close()
  }
})

test('reports an unexpected dispatch failure as a transport error', async () => {
  const store = await storeFixture()
  const { ctx, routes } = hostHarness()
  try {
    await store.close()
    registerTraceRoutes(ctx as never, store, workspaceForSession)
    const route = routes.find(candidate => candidate.path === traceRpcPath('requests.list'))!
    const response = await route.fetch(post(traceRpcPath('requests.list'), envelope(traceRpcAddress('requests.list'), {
      sessionId: 'session-a',
      limit: 20,
    })))
    assert.equal(response.status, 500)
    assert.match(await response.text(), /dsh-trace handler failure: /)
  } finally {
    await store.close().catch(() => undefined)
  }
})
