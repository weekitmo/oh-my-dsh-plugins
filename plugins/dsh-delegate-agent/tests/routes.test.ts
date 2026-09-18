import assert from 'node:assert/strict'
import test from 'node:test'
import { DELEGATE_RPC_ENDPOINTS, delegateRpcAddress, delegateRpcPath } from '../src/rpc-contract.ts'
import { registerDelegateRoutes } from '../src/delegation/routes.ts'
import type { DelegatePreset, DelegatePresetInput } from '../src/types.ts'

interface RegisteredRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

const preset: DelegatePreset = {
  id: 'preset-one', workspaceId: 'workspace', name: 'Reviewer', adapterId: 'codex',
  permissionMode: 'read-only', model: 'fixed-model', fixedInstructions: 'Review carefully.\n\n{{task}}',
  createdAt: 1, updatedAt: 1,
}

const runtime = {
  publicConfig: () => ({ maxConcurrentRuns: 1 }),
  adapters: () => Promise.resolve([]),
  list: (sessionId: string) => ({ tasks: [], activeCount: sessionId === 'session' ? 0 : 1 }),
  get: () => undefined,
  start: (request: unknown) => Promise.resolve(request),
  cancel: () => Promise.resolve('requested' as const),
  clear: () => Promise.resolve(3),
}

const presets = {
  list: (workspaceId: string) => workspaceId === 'workspace' ? [preset] : [],
  get: (id: string, workspaceId: string) => id === preset.id && workspaceId === preset.workspaceId ? preset : undefined,
  create: (workspaceId: string, input: DelegatePresetInput) => Promise.resolve({
    id: 'created', workspaceId, ...input, createdAt: 2, updatedAt: 2,
  }),
  update: () => Promise.resolve(undefined),
  delete: () => Promise.resolve(false),
}

const workspaces = {
  list: () => [
    { id: 'workspace', path: '/workspace', sessionIds: ['session'] },
    { id: 'other-workspace', path: '/other', sessionIds: ['other-session'] },
  ],
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

function register(ctx: unknown): () => Promise<void> {
  return registerDelegateRoutes(ctx as never, runtime as never, presets as never, workspaces)
}

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
  const { ctx, routes } = hostHarness()
  const dispose = register(ctx)
  assert.deepEqual(routes.map(route => route.path), DELEGATE_RPC_ENDPOINTS.map(delegateRpcPath))
  assert.ok(routes.every(route => route.path.startsWith('/api/dsh-delegate-agent/')))
  for (const route of routes) {
    assert.deepEqual(route.methods, ['POST'])
    assert.equal(route.requestBody, 'buffered')
  }
  await dispose()
  assert.deepEqual(routes, [])
})

test('answers a request with the correlated server-response envelope', async () => {
  const { ctx, routes } = hostHarness()
  register(ctx)
  const route = routes.find(candidate => candidate.path === delegateRpcPath('config.get'))!
  const response = await route.fetch(post(delegateRpcPath('config.get'), envelope(delegateRpcAddress('config.get'), {})))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'rpc-1',
    result: { ok: true, value: { maxConcurrentRuns: 1 } },
  })
})

test('routes dispatch failures through the correlated envelope', async () => {
  const { ctx, routes } = hostHarness()
  register(ctx)
  const route = routes.find(candidate => candidate.path === delegateRpcPath('tasks.start'))!
  const response = await route.fetch(post(delegateRpcPath('tasks.start'), envelope(delegateRpcAddress('tasks.start'), {
    sessionId: 'missing',
    adapterId: 'pi',
    prompt: 'x',
  }, 'rpc-2')))
  assert.equal(response.status, 200)
  const body = await response.json() as { rpcId: string, result: { ok: boolean, error?: { code: string } } }
  assert.equal(body.rpcId, 'rpc-2')
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error?.code, 'delegate/workspace-not-found')
})

test('rejects a malformed body and a mismatched method without dispatching', async () => {
  const { ctx, routes } = hostHarness()
  register(ctx)
  const route = routes.find(candidate => candidate.path === delegateRpcPath('config.get'))!

  const notJson = await route.fetch(new Request(`http://dsh.internal${delegateRpcPath('config.get')}`, {
    method: 'POST',
    body: 'not json',
  }))
  assert.equal(notJson.status, 400)

  const wrongMethod = await route.fetch(post(
    delegateRpcPath('config.get'),
    envelope(delegateRpcAddress('tasks.list'), { sessionId: 'session' }, 'rpc-3'),
  ))
  assert.deepEqual(await wrongMethod.json(), {
    type: 'server-response',
    rpcId: 'rpc-3',
    result: {
      ok: false,
      error: {
        code: 'gateway/bad-request',
        message: 'method "dsh-delegate-agent/tasks.list" does not match endpoint "dsh-delegate-agent/config.get"',
        details: {},
      },
    },
  })
})
