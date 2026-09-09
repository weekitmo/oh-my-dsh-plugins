import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DelegateTask } from '../src/types.ts'
import { DelegateTaskStore } from '../src/delegation/store.ts'

function task(id: string, status: DelegateTask['status']): DelegateTask {
  return {
    id, ownerSessionId: 'session', workspaceId: 'workspace', adapterId: 'pi', prompt: 'x', cwd: '/tmp',
    permissionMode: 'read-only', status, command: ['pi', '<prompt>'], createdAt: Date.now(), updatedAt: Date.now(),
    stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
    events: [], timedOut: false,
  }
}

test('task store persists records and marks live tasks interrupted on reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-store-'))
  try {
    const first = new DelegateTaskStore(directory, 30)
    await chmod(directory, 0o755)
    await first.initialize()
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    await first.put(task('one', 'running'), true)
    await first.close()

    const second = new DelegateTaskStore(directory, 30)
    await second.initialize()
    const restored = second.get('one')
    assert.equal(restored?.status, 'interrupted')
    assert.match(restored?.diagnostic ?? '', /stopped before/u)
    assert.equal(JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8')).length, 1)
    await second.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('task store can persist again after a failed write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-store-'))
  const store = new DelegateTaskStore(directory, 30)
  try {
    await store.initialize()
    await chmod(directory, 0o500)
    await assert.rejects(store.put(task('blocked', 'completed'), true))
    await chmod(directory, 0o700)
    await store.put(task('recovered', 'completed'), true)
    const records = JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8')) as DelegateTask[]
    assert.deepEqual(records.map(record => record.id).sort(), ['blocked', 'recovered'])
  } finally {
    await chmod(directory, 0o700)
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('task store prunes expired tasks during runtime writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-store-'))
  const store = new DelegateTaskStore(directory, 1)
  try {
    await store.initialize()
    const expired = { ...task('expired', 'completed'), finishedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 }
    await store.put(expired, true)
    assert.equal(store.get('expired'), undefined)
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('task store manual clear removes only finished tasks in one session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-store-'))
  const store = new DelegateTaskStore(directory, 30)
  try {
    await store.initialize()
    await store.put({ ...task('done', 'completed'), finishedAt: Date.now() }, true)
    await store.put(task('live', 'running'), true)
    await store.put({ ...task('other', 'completed'), ownerSessionId: 'other', finishedAt: Date.now() }, true)
    assert.equal(await store.clearFinished('session'), 1)
    assert.deepEqual(store.list('session').map(value => value.id), ['live'])
    assert.deepEqual(store.list('other').map(value => value.id), ['other'])
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
