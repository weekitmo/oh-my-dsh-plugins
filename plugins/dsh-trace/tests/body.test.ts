import assert from 'node:assert/strict'
import test from 'node:test'
import { readBoundedBody } from '../src/trace/body.ts'

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function streamThenError(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk !== undefined) {
        controller.enqueue(encoder.encode(chunk))
        return
      }
      controller.error(new Error('DeepSeek stream consumer stopped'))
    },
  })
}

test('reads an exact-limit body without marking it truncated', async () => {
  const body = await readBoundedBody(stream('1234', '5678'), {
    maxBytes: 8,
    signal: new AbortController().signal,
    contentType: 'text/plain',
  })
  assert.deepEqual(body, { raw: '12345678', format: 'text', bytes: 8, truncated: false })
})

test('bounds a body larger than the configured limit', async () => {
  const body = await readBoundedBody(stream('1234', '5678', '9'), {
    maxBytes: 8,
    signal: new AbortController().signal,
    contentType: 'text/plain',
  })
  assert.deepEqual(body, { raw: '12345678', format: 'text', bytes: 8, truncated: true })
})

test('encodes binary response bodies instead of decoding arbitrary bytes as text', async () => {
  const body = await readBoundedBody(new Blob([new Uint8Array([0, 255, 1])]).stream(), {
    maxBytes: 8,
    signal: new AbortController().signal,
    contentType: 'application/octet-stream',
  })
  assert.deepEqual(body, { raw: 'AP8B', format: 'base64', bytes: 3, truncated: false })
})

test('treats a framed SSE DONE event as complete when transport teardown follows', async () => {
  const chunks = [
    'data: {"delta":"ok"}\n\n',
    'data: [DONE]\r\n\r\n',
  ]
  const body = await readBoundedBody(streamThenError(chunks), {
    maxBytes: 1024,
    signal: new AbortController().signal,
    contentType: 'text/event-stream; charset=utf-8',
  })
  assert.deepEqual(body, {
    raw: 'data: {"delta":"ok"}\n\ndata: [DONE]\n\n',
    format: 'sse',
    bytes: new TextEncoder().encode(chunks.join('')).byteLength,
    truncated: false,
    parsed: [{ delta: 'ok' }],
  })
})

test('keeps an SSE body truncated when transport fails before a complete DONE event', async () => {
  const body = await readBoundedBody(streamThenError([
    'data: {"delta":"ok"}\n\n',
    'data: [DONE]',
  ]), {
    maxBytes: 1024,
    signal: new AbortController().signal,
    contentType: 'text/event-stream',
  })
  assert.equal(body?.truncated, true)
  assert.match(body?.captureError ?? '', /DeepSeek stream consumer stopped/)
})

test('does not let an SSE DONE prefix hide max-byte truncation', async () => {
  const raw = 'data: {"delta":"ok"}\n\ndata: [DONE]\n\n'
  const body = await readBoundedBody(stream(raw), {
    maxBytes: new TextEncoder().encode(raw).byteLength - 1,
    signal: new AbortController().signal,
    contentType: 'text/event-stream',
  })
  assert.equal(body?.raw.endsWith('data: [DONE]\n'), true)
  assert.equal(body?.truncated, true)
})
