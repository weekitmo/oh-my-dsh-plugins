import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../src/index.ts'

test('applies bounded request-trace configuration defaults', () => {
  assert.deepEqual(Config({}), {
    retentionHours: 24,
    maxRequestBodyBytes: 1024 * 1024,
    maxResponseBodyBytes: 4 * 1024 * 1024,
    maxRecords: 10_000,
    maxStorageBytes: 128 * 1024 * 1024,
  })
})

test('rejects invalid request-trace limits at the plugin schema boundary', () => {
  assert.throws(() => Config({ retentionHours: 0 }), /retentionHours.*>= 1/)
  assert.throws(() => Config({ maxRecords: 1.5 }), /maxRecords.*multiple of 1/)
})
