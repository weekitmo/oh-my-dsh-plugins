import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { TraceSqliteStore } from '../src/trace/store.ts'
import { record } from './helpers.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const WORKER = fileURLToPath(new URL('./sqlite-writer.ts', import.meta.url))

function fixture(now: number, limits: Partial<ConstructorParameters<typeof TraceSqliteStore>[0]> = {}) {
  const directory = join(tmpdir(), `dsh-trace-${randomUUID()}`)
  const path = join(directory, 'requests.sqlite')
  const store = new TraceSqliteStore({
    path,
    retentionMs: 3 * DAY_MS,
    maxRecords: 100,
    maxStorageBytes: 1024 * 1024,
    now: () => now,
    ...limits,
  })
  return { directory, path, store }
}

const scope = { workspaceId: 'workspace-a', sessionId: 'session-a' } as const

function sessionlessRecord(id: string, startedAt: number) {
  const { sessionId, ...sessionless } = record(id, startedAt)
  void sessionId
  return sessionless
}

function runWriter(path: string, prefix: string, startedAt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER, path, prefix, String(startedAt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`writer ${prefix} exited ${String(code)} signal ${String(signal)}: ${stderr}`))
    })
  })
}

test('persists summaries separately from scoped details', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { path, store } = fixture(now)
  await store.initialize()
  try {
    const full = record('request-a', now, {
      ...scope,
      requestBody: { raw: '{"secret":"value"}', format: 'json', bytes: 18, truncated: false },
    })
    await store.append(full)

    const listed = await store.list({ ...scope, limit: 20 })
    assert.equal(listed.requests.length, 1)
    assert.equal('requestBody' in (listed.requests[0] ?? {}), false)
    assert.deepEqual(await store.get('request-a', scope), full)
    assert.equal(await store.get('request-a', { workspaceId: 'workspace-b', sessionId: 'session-a' }), undefined)
    assert.equal(await store.get('request-a', { workspaceId: 'workspace-a', sessionId: 'session-b' }), undefined)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700)
  } finally {
    await store.close()
  }
})

test('filters by workspace and session and clears only the requested scope', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { store } = fixture(now)
  await store.initialize()
  try {
    await store.append(record('a', now, { workspaceId: 'workspace-a', sessionId: 'session-a' }))
    await store.append(record('b', now + 1, { workspaceId: 'workspace-b', sessionId: 'session-b' }))
    await store.append(record('same-id-other-workspace', now + 2, {
      workspaceId: 'workspace-b', sessionId: 'session-a',
    }))
    await store.append(record('legacy-a', now + 3, { sessionId: 'session-a' }))

    assert.deepEqual(
      (await store.list({ workspaceId: 'workspace-a', sessionId: 'session-a', limit: 20 })).requests.map(item => item.id),
      ['legacy-a', 'a'],
    )
    assert.deepEqual(
      (await store.list({ workspaceId: 'workspace-b', sessionId: 'session-b', limit: 20 })).requests.map(item => item.id),
      ['b'],
    )
    assert.deepEqual(
      (await store.list({ sessionId: 'session-a', limit: 20 })).requests.map(item => item.id),
      ['legacy-a'],
    )
    assert.equal(await store.get('a', { sessionId: 'session-a' }), undefined)
    assert.equal((await store.get('legacy-a', { sessionId: 'session-a' }))?.id, 'legacy-a')

    await store.clear({ sessionId: 'session-a' })
    assert.equal((await store.get('a', scope))?.id, 'a')
    assert.equal(await store.get('legacy-a', scope), undefined)
    await store.clear(scope)
    assert.deepEqual(await store.list({ ...scope, limit: 20 }), { requests: [], hasMore: false })
    assert.deepEqual(
      (await store.list({ workspaceId: 'workspace-b', sessionId: 'session-b', limit: 20 })).requests.map(item => item.id),
      ['b'],
    )
  } finally {
    await store.close()
  }
})

test('enforces retention, record count, and logical UTF-8 storage limits', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const countFixture = fixture(now, { maxRecords: 3 })
  await countFixture.store.initialize()
  try {
    for (let index = 0; index < 7; index += 1) {
      await countFixture.store.append(record(`r-${String(index)}`, now + index, scope))
    }
    assert.deepEqual(
      (await countFixture.store.list({ ...scope, limit: 20 })).requests.map(item => item.id),
      ['r-6', 'r-5', 'r-4'],
    )
  } finally {
    await countFixture.store.close()
  }

  const bytesFixture = fixture(now, { maxStorageBytes: 1 })
  await bytesFixture.store.initialize()
  try {
    await bytesFixture.store.append(record('too-large', now, scope))
    assert.deepEqual(await bytesFixture.store.list({ ...scope, limit: 20 }), { requests: [], hasMore: false })
  } finally {
    await bytesFixture.store.close()
  }

  const retentionFixture = fixture(now, { retentionMs: 60_000 })
  await retentionFixture.store.initialize()
  try {
    await retentionFixture.store.append(record('expired', now - 60_001, scope))
    await retentionFixture.store.append(record('kept', now, scope))
    assert.deepEqual(
      (await retentionFixture.store.list({ ...scope, limit: 20 })).requests.map(item => item.id),
      ['kept'],
    )
  } finally {
    await retentionFixture.store.close()
  }
})

test('paginates equal timestamps with a stable binary id cursor', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { store } = fixture(now)
  await store.initialize()
  try {
    for (const id of ['a', 'Z', 'b']) await store.append(record(id, now, scope))

    const first = await store.list({ ...scope, limit: 2 })
    assert.deepEqual(first.requests.map(item => item.id), ['b', 'a'])
    assert.equal(first.hasMore, true)
    const last = first.requests.at(-1)!
    const second = await store.list({ ...scope, limit: 2, before: { startedAt: last.startedAt, id: last.id } })
    assert.deepEqual(second.requests.map(item => item.id), ['Z'])
    assert.equal(second.hasMore, false)
  } finally {
    await store.close()
  }
})

test('applies retention changes and hides newly expired rows immediately on reads', async () => {
  let now = Date.UTC(2026, 7, 31, 12)
  const directory = join(tmpdir(), `dsh-trace-${randomUUID()}`)
  const store = new TraceSqliteStore({
    path: join(directory, 'requests.sqlite'),
    retentionMs: 3 * DAY_MS,
    maxRecords: 100,
    maxStorageBytes: 1024 * 1024,
    now: () => now,
  })
  await store.initialize()
  try {
    await store.append(record('old', now - 2 * 60 * 60 * 1000, scope))
    await store.append(record('recent', now - 30 * 60 * 1000, scope))
    await store.setRetentionMs(60 * 60 * 1000)

    assert.equal(await store.get('old', scope), undefined)
    assert.equal((await store.get('recent', scope))?.id, 'recent')
    now += 2 * 60 * 60 * 1000
    assert.deepEqual(await store.list({ ...scope, limit: 20 }), { requests: [], hasMore: false })
    assert.equal(await store.get('recent', scope), undefined)
    await assert.rejects(store.setRetentionMs(0), /positive safe integer/)
  } finally {
    await store.close()
  }
})

test('migrates valid legacy JSONL rows, skips damage, and archives the source', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { directory, path } = fixture(now)
  const legacyJsonlPath = join(directory, 'requests.jsonl')
  await mkdir(directory, { recursive: true })
  await writeFile(legacyJsonlPath, [
    JSON.stringify(record('migrated', now, { sessionId: 'session-a' })),
    JSON.stringify(record('malformed-optional', now, { sessionId: 'session-a', purpose: {} as never })),
    JSON.stringify(sessionlessRecord('sessionless', now)),
    '{broken json',
    JSON.stringify({ id: 'invalid' }),
    '',
  ].join('\n'))
  const store = new TraceSqliteStore({
    path,
    legacyJsonlPath,
    retentionMs: DAY_MS,
    maxRecords: 100,
    maxStorageBytes: 1024 * 1024,
    now: () => now,
    resolveWorkspaceId: sessionId => sessionId === 'session-a' ? 'workspace-a' : undefined,
  })
  await store.initialize()
  try {
    assert.equal((await store.get('migrated', scope))?.workspaceId, 'workspace-a')
    assert.equal(await store.get('malformed-optional', scope), undefined)
    assert.equal(await store.get('sessionless', { sessionId: 'session-a' }), undefined)
    await store.append(sessionlessRecord('runtime-sessionless', now))
    assert.deepEqual(
      (await store.list({ ...scope, limit: 20 })).requests.map(item => item.id),
      ['migrated'],
    )
    const files = await readdir(directory)
    assert.equal(files.includes('requests.jsonl'), false)
    assert.equal(files.some(name => name.startsWith('requests.jsonl.migrated-')), true)
  } finally {
    await store.close()
  }
})

test('writer lock contention yields the event loop while retrying', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { path, store } = fixture(now, { busyTimeoutMs: 500 })
  await store.initialize()
  const blocker = new DatabaseSync(path, { timeout: 0 })
  try {
    blocker.exec('BEGIN IMMEDIATE')
    let timerFired = false
    const release = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        blocker.exec('COMMIT')
        resolve()
      }, 20)
    })
    await Promise.all([store.append(record('after-lock', now, scope)), release])
    assert.equal(timerFired, true)
    assert.equal((await store.get('after-lock', scope))?.id, 'after-lock')
  } finally {
    blocker.close()
    await store.close()
  }
})

test('two independent Node processes concurrently append to one WAL database', async () => {
  const now = Date.UTC(2026, 7, 31, 12)
  const { path } = fixture(now)
  await Promise.all([
    runWriter(path, 'left', now),
    runWriter(path, 'right', now + 100),
  ])

  const store = new TraceSqliteStore({
    path,
    retentionMs: DAY_MS,
    maxRecords: 1_000,
    maxStorageBytes: 16 * 1024 * 1024,
    now: () => now + 1_000,
  })
  await store.initialize()
  try {
    const requests = (await store.list({ ...scope, limit: 100 })).requests
    assert.equal(requests.length, 60)
    assert.equal(new Set(requests.map(item => item.id)).size, 60)
    assert.equal((await readFile(path)).subarray(0, 15).toString(), 'SQLite format 3')
  } finally {
    await store.close()
  }
})
