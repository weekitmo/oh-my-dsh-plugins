import assert from 'node:assert/strict'
import test from 'node:test'
import { installLlmFetchCapture } from '../src/trace/capture.ts'
import type { TraceRequestRecord } from '../src/trace/types.ts'

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _item of stream) { /* drain */ }
}

test('captures only scoped LLM fetches and separates concurrent contexts', async () => {
  const nativeFetch = globalThis.fetch
  const records: TraceRequestRecord[] = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    return new Response(JSON.stringify({ url: request.url }), {
      headers: { 'content-type': 'application/json', 'x-request-id': request.url.split('/').at(-1) ?? '' },
    })
  }
  const underlying = globalThis.fetch
  const capture = installLlmFetchCapture({ append: record => { records.push(record); return Promise.resolve() } }, {
    maxRequestBodyBytes: 1024,
    maxResponseBodyBytes: 1024,
  })
  try {
    await fetch('https://trace.example/unscoped')
    const call = (sessionId: string, token: string) => drain(capture.wrapStream({
      provider: 'deepseek', model: 'chat', workspaceId: `workspace-${sessionId}`, sessionId,
    }, () => (async function* () {
      const response = await fetch(`https://trace.example/${sessionId}?api_key=${token}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: sessionId, apiKey: token }),
      })
      await response.text()
      yield undefined
    })()))
    await Promise.all([call('session-a', 'secret-a'), call('session-b', 'secret-b')])
    await capture.flush()

    assert.equal(records.length, 2)
    assert.deepEqual(new Set(records.map(record => record.sessionId)), new Set(['session-a', 'session-b']))
    assert.deepEqual(
      new Set(records.map(record => record.workspaceId)),
      new Set(['workspace-session-a', 'workspace-session-b']),
    )
    for (const record of records) {
      assert.equal(record.attempt, 1)
      assert.equal(record.requestHeaders.authorization, '[REDACTED]')
      assert.equal(record.url.includes('secret-'), false)
      assert.equal(record.requestBody?.raw.includes('secret-'), false)
      assert.equal(record.responseStatus, 200)
    }
  } finally {
    await capture.stop()
    assert.equal(globalThis.fetch, underlying)
    globalThis.fetch = nativeFetch
  }
})

test('records retries, HTTP failures, rejected fetches, and aborts', async () => {
  const nativeFetch = globalThis.fetch
  const records: TraceRequestRecord[] = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/reject')) throw new TypeError('network unavailable token=private')
    if (request.url.endsWith('/abort')) throw new DOMException('caller stopped', 'AbortError')
    return new Response('{"error":"bad gateway"}', {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
  const capture = installLlmFetchCapture({ append: record => { records.push(record); return Promise.resolve() } }, {
    maxRequestBodyBytes: 1024,
    maxResponseBodyBytes: 1024,
  })
  try {
    await assert.rejects(drain(capture.wrapStream({ provider: 'p', model: 'm' }, () => (async function* () {
      const response = await fetch('https://trace.example/http')
      await response.text()
      await assert.rejects(fetch('https://trace.example/reject'))
      await fetch('https://trace.example/abort')
      yield undefined
    })())), { name: 'AbortError' })
    await capture.flush()

    assert.deepEqual(records.map(record => record.attempt).sort(), [1, 2, 3])
    assert.equal(records.find(record => record.url.endsWith('/http'))?.responseStatus, 502)
    const rejected = records.find(record => record.url.endsWith('/reject'))
    assert.match(rejected?.error ?? '', /network unavailable/)
    assert.equal(rejected?.error?.includes('private'), false)
    assert.equal(records.find(record => record.url.endsWith('/abort'))?.aborted, true)
  } finally {
    await capture.stop()
    globalThis.fetch = nativeFetch
  }
})

test('captures redacted SSE and bounds large response bodies', async () => {
  const nativeFetch = globalThis.fetch
  const records: TraceRequestRecord[] = []
  globalThis.fetch = async (input) => {
    const url = new Request(input).url
    if (url.endsWith('/sse')) {
      return new Response('data: {"delta":"ok","token":"secret"}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return new Response('x'.repeat(80), { headers: { 'content-type': 'text/plain' } })
  }
  const capture = installLlmFetchCapture({ append: record => { records.push(record); return Promise.resolve() } }, {
    maxRequestBodyBytes: 16,
    maxResponseBodyBytes: 64,
  })
  try {
    await drain(capture.wrapStream({ provider: 'p', model: 'm', purpose: 'compaction' }, () => (async function* () {
      await (await fetch('https://trace.example/sse')).text()
      await (await fetch('https://trace.example/large')).text()
      yield undefined
    })()))
    await capture.flush()

    const sse = records.find(record => record.url.endsWith('/sse'))
    assert.equal(sse?.purpose, 'compaction')
    assert.equal(sse?.responseBody?.format, 'sse')
    assert.equal(sse?.responseBody?.raw.includes('secret'), false)
    assert.deepEqual(sse?.responseBody?.parsed, [{ delta: 'ok', token: '[REDACTED]' }])
    const large = records.find(record => record.url.endsWith('/large'))
    assert.equal(large?.responseBody?.raw, 'x'.repeat(64))
    assert.equal(large?.responseBody?.truncated, true)
  } finally {
    await capture.stop()
    globalThis.fetch = nativeFetch
  }
})

test('does not disturb a Request body before the original fetch consumes it', async () => {
  const nativeFetch = globalThis.fetch
  const records: TraceRequestRecord[] = []
  let passedInput: Request | undefined
  let bodyUsedAtCall: boolean | undefined
  let receivedBody: string | undefined
  globalThis.fetch = async (input) => {
    assert.ok(input instanceof Request)
    passedInput = input
    bodyUsedAtCall = input.bodyUsed
    receivedBody = await input.text()
    return new Response('ok', { headers: { 'content-type': 'text/plain' } })
  }
  const capture = installLlmFetchCapture({ append: record => { records.push(record); return Promise.resolve() } }, {
    maxRequestBodyBytes: 1024,
    maxResponseBodyBytes: 1024,
  })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":"streamed"}'))
      controller.close()
    },
  })
  const request = new Request('https://trace.example/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  try {
    await drain(capture.wrapStream({ provider: 'p', model: 'm' }, () => (async function* () {
      await (await fetch(request)).text()
      yield undefined
    })()))
    await capture.flush()

    assert.equal(passedInput, request)
    assert.equal(bodyUsedAtCall, false)
    assert.equal(receivedBody, '{"message":"streamed"}')
    assert.equal(records[0]?.requestBody?.raw, '{"message":"streamed"}')
  } finally {
    await capture.stop()
    globalThis.fetch = nativeFetch
  }
})

test('tees a streaming init body so capture and the original fetch both receive it', async () => {
  const nativeFetch = globalThis.fetch
  const records: TraceRequestRecord[] = []
  let receivedBody: string | undefined
  globalThis.fetch = async (input, init) => {
    receivedBody = await new Request(input, init).text()
    return new Response('ok')
  }
  const capture = installLlmFetchCapture({ append: record => { records.push(record); return Promise.resolve() } }, {
    maxRequestBodyBytes: 1024,
    maxResponseBodyBytes: 1024,
  })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('streaming init body'))
      controller.close()
    },
  })
  try {
    await drain(capture.wrapStream({ provider: 'p', model: 'm' }, () => (async function* () {
      await fetch('https://trace.example/init-stream', {
        method: 'POST', body, duplex: 'half',
      } as RequestInit & { duplex: 'half' })
      yield undefined
    })()))
    await capture.flush()

    assert.equal(receivedBody, 'streaming init body')
    assert.equal(records[0]?.requestBody?.raw, 'streaming init body')
  } finally {
    await capture.stop()
    globalThis.fetch = nativeFetch
  }
})
