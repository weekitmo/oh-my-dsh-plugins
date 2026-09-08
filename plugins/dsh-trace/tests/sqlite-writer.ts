import { TraceSqliteStore } from '../src/trace/store.ts'
import { record } from './helpers.ts'

const [path, prefix, rawStartedAt] = process.argv.slice(2)
if (path === undefined || prefix === undefined || rawStartedAt === undefined) {
  throw new Error('usage: sqlite-writer.ts <path> <prefix> <startedAt>')
}
const startedAt = Number(rawStartedAt)
if (!Number.isSafeInteger(startedAt)) throw new Error('startedAt must be a safe integer')

const store = new TraceSqliteStore({
  path,
  retentionMs: 24 * 60 * 60 * 1000,
  maxRecords: 1_000,
  maxStorageBytes: 16 * 1024 * 1024,
  now: () => startedAt + 1_000,
})
await store.initialize()
try {
  for (let index = 0; index < 30; index += 1) {
    await store.append(record(`${prefix}-${String(index).padStart(2, '0')}`, startedAt + index, {
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    }))
  }
} finally {
  await store.close()
}
