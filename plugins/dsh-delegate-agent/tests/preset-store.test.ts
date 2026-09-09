import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DelegatePresetStore, PresetConflictError } from '../src/delegation/preset-store.ts'
import type { DelegatePresetInput } from '../src/types.ts'

const input: DelegatePresetInput = {
  name: 'Reviewer', adapterId: 'codex', permissionMode: 'read-only', model: 'test-model',
  fixedInstructions: 'Review carefully.\n\n{{task}}',
}

test('preset store rolls back an in-memory create when persistence fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-presets-'))
  const store = new DelegatePresetStore(directory)
  try {
    await chmod(directory, 0o755)
    await store.initialize()
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    await chmod(directory, 0o500)
    await assert.rejects(store.create('workspace-a', input))
    assert.deepEqual(store.list('workspace-a'), [])
  } finally {
    await chmod(directory, 0o700)
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('preset store persists workspace-scoped records and enforces names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-presets-'))
  try {
    const first = new DelegatePresetStore(directory)
    await first.initialize()
    const created = await first.create('workspace-a', input)
    await first.create('workspace-b', input)
    await assert.rejects(first.create('workspace-a', { ...input, name: ' reviewer ' }), PresetConflictError)
    assert.equal(first.get(created.id, 'workspace-b'), undefined)
    await first.close()

    const second = new DelegatePresetStore(directory)
    await second.initialize()
    assert.deepEqual(second.list('workspace-a').map(preset => preset.name), ['Reviewer'])
    assert.equal(JSON.parse(await readFile(join(directory, 'presets.json'), 'utf8')).length, 2)
    const updated = await second.update(created.id, 'workspace-a', { ...input, name: 'Code reviewer' })
    assert.equal(updated?.name, 'Code reviewer')
    assert.equal(await second.delete(created.id, 'workspace-b'), false)
    assert.equal(await second.delete(created.id, 'workspace-a'), true)
    await second.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
