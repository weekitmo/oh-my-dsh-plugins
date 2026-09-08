import assert from 'node:assert/strict'
import test from 'node:test'
import { REDACTED, redactCapturedBody, redactHeaders, redactUrl } from '../src/trace/redaction.ts'

test('redacts sensitive headers without hiding ordinary request metadata', () => {
  const headers = new Headers({
    authorization: 'Bearer live-key',
    'x-api-key': 'another-key',
    'x-goog-api-key': 'gemini-key',
    'content-type': 'application/json',
    'x-request-id': 'request-123',
  })
  assert.deepEqual(redactHeaders(headers), {
    authorization: REDACTED,
    'content-type': 'application/json',
    'x-api-key': REDACTED,
    'x-goog-api-key': REDACTED,
    'x-request-id': 'request-123',
  })
})

test('redacts nested JSON secrets in raw and parsed views', () => {
  const body = redactCapturedBody(JSON.stringify({
    model: 'deepseek-chat',
    api_key: 'secret-key',
    nested: { accessToken: 'secret-token', password: 'secret-password', keep: 'visible' },
  }), 'json', 120, false)
  assert.equal(body.raw.includes('secret-key'), false)
  assert.equal(body.raw.includes('secret-token'), false)
  assert.equal(body.raw.includes('secret-password'), false)
  assert.deepEqual(body.parsed, {
    model: 'deepseek-chat',
    api_key: REDACTED,
    nested: { accessToken: REDACTED, password: REDACTED, keep: 'visible' },
  })
})

test('redacts each structured SSE data event and preserves DONE', () => {
  const body = redactCapturedBody([
    'event: message',
    'data: {"delta":"ok","token":"secret-token"}',
    '',
    'data: [DONE]',
    '',
  ].join('\n'), 'sse', 96, false)
  assert.equal(body.raw.includes('secret-token'), false)
  assert.equal(body.raw.includes('[DONE]'), true)
  assert.deepEqual(body.parsed, [{ delta: 'ok', token: REDACTED }])
})

test('redacts credential query parameters and leaves routing parameters visible', () => {
  assert.equal(
    redactUrl('https://gateway.example/models?api_key=secret&region=cn&token=other'),
    `https://gateway.example/models?api_key=${encodeURIComponent(REDACTED)}&region=cn&token=${encodeURIComponent(REDACTED)}`,
  )
})

test('removes URL userinfo before persisting a trace URL', () => {
  assert.equal(
    redactUrl('https://alice:password@gateway.example/models?region=cn'),
    'https://gateway.example/models?region=cn',
  )
})
