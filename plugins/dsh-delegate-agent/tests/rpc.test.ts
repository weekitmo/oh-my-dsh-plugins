import assert from 'node:assert/strict'
import test from 'node:test'
import { handleDelegateRpc } from '../src/delegation/rpc.ts'
import type { DelegatePreset, DelegatePresetInput } from '../src/types.ts'

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

const call = (endpoint: string, payload: unknown) => handleDelegateRpc(
  runtime as never, presets as never, workspaces, endpoint, payload,
)

test('RPC rejects dispatch for a session without an attached workspace', async () => {
  const result = await call('tasks.start', { sessionId: 'missing', adapterId: 'pi', prompt: 'x' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'delegate/workspace-not-found')
})

test('RPC derives cwd and workspace identity instead of accepting browser cwd', async () => {
  const result = await call('tasks.start', {
    sessionId: 'session', adapterId: 'grok', prompt: 'x', cwd: '/forged', permissionMode: 'read-only',
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal((result.value as { cwd: string }).cwd, '/workspace')
    assert.equal((result.value as { workspaceId: string }).workspaceId, 'workspace')
  }
})

test('RPC validates adapter and permission mode before runtime dispatch', async () => {
  const invalidAdapter = await call('tasks.start', { sessionId: 'session', adapterId: 'shell', prompt: 'x' })
  const invalidPermission = await call('tasks.start', {
    sessionId: 'session', adapterId: 'pi', prompt: 'x', permissionMode: 'bypass',
  })
  assert.equal(invalidAdapter.ok, false)
  assert.equal(invalidPermission.ok, false)
})

test('RPC composes a named preset task with fixed parameters', async () => {
  const result = await call('tasks.start', {
    sessionId: 'session', presetId: 'preset-one', instruction: 'Check the RPC boundary.',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  const request = result.value as { adapterId: string; model: string; prompt: string; permissionMode: string }
  assert.equal(request.adapterId, 'codex')
  assert.equal(request.model, 'fixed-model')
  assert.equal(request.permissionMode, 'read-only')
  assert.equal(request.prompt, 'Review carefully.\n\nCheck the RPC boundary.')
})

test('RPC keeps presets workspace scoped and ignores a forged workspace id', async () => {
  const hidden = await call('presets.list', { sessionId: 'other-session', workspaceId: 'workspace' })
  const created = await call('presets.create', {
    sessionId: 'session', workspaceId: 'forged', name: 'Writer', adapterId: 'pi',
    permissionMode: 'workspace-write', fixedInstructions: 'Implement {{task}}',
  })
  assert.equal(hidden.ok, true)
  if (hidden.ok) assert.deepEqual(hidden.value, [])
  assert.equal(created.ok, true)
  if (created.ok) assert.equal((created.value as DelegatePreset).workspaceId, 'workspace')
})

test('RPC manual clear returns the number of removed terminal tasks', async () => {
  const result = await call('tasks.clear', { sessionId: 'session' })
  assert.deepEqual(result, { ok: true, value: { removed: 3 } })
})
