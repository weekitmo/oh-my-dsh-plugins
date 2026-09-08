import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseTraceListResult, parseTraceRequestRecord,
} from '../src/client/trace-client.ts'
import { record } from './helpers.ts'

test('accepts complete trace RPC values', () => {
  const full = record('request-a', Date.UTC(2026, 7, 31, 12))
  const summary = {
    id: full.id,
    logicalRequestId: full.logicalRequestId,
    attempt: full.attempt,
    startedAt: full.startedAt,
    completedAt: full.completedAt,
    expiresAt: full.startedAt + 24 * 60 * 60 * 1000,
    durationMs: full.durationMs,
    provider: full.provider,
    model: full.model,
    sessionId: full.sessionId,
    method: full.method,
    url: full.url,
    responseStatus: full.responseStatus,
    truncated: false,
  }
  assert.equal(parseTraceRequestRecord(full), full)
  const list = { requests: [summary], hasMore: false }
  assert.equal(parseTraceListResult(list), list)
})

test('rejects partial or non-finite trace RPC values', () => {
  const full = record('request-a', Date.UTC(2026, 7, 31, 12))
  assert.throws(() => parseTraceRequestRecord({ ...full, requestHeaders: [] }), /invalid request record/)
  assert.throws(() => parseTraceListResult({
    requests: [{
      id: 'request-a',
      logicalRequestId: 'logical-a',
      attempt: 1,
      startedAt: Number.NaN,
      completedAt: 1,
      durationMs: 1,
      provider: 'p',
      model: 'm',
      method: 'POST',
      url: 'https://example.test',
      truncated: false,
    }],
    hasMore: false,
  }), /invalid request summary/)
})
