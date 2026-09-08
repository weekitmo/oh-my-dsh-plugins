import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { readBoundedBody } from './body.ts'
import { redactHeaders, redactText, redactUrl } from './redaction.ts'
import type {
  LlmTraceContext,
  TraceBody,
  TraceRequestRecord,
} from './types.ts'

export interface LlmFetchCaptureOptions {
  readonly maxRequestBodyBytes: number
  readonly maxResponseBodyBytes: number
  readonly now?: () => number
  readonly createId?: () => string
  readonly onError?: (error: unknown) => void
}

export interface LlmStreamTrace {
  readonly provider: string
  readonly model: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly purpose?: string
}

export interface TraceRecordSink {
  append(record: TraceRequestRecord): Promise<void>
}

export interface LlmFetchCapture {
  wrapStream<T>(trace: LlmStreamTrace, next: () => AsyncIterable<T>): AsyncIterable<T>
  flush(): Promise<void>
  stop(): Promise<void>
}

function renderError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return String(error)
  } catch {
    return 'unrenderable fetch error'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError'
}

function captureFailure(error: unknown): TraceBody {
  return {
    raw: '',
    format: 'text',
    bytes: 0,
    truncated: false,
    captureError: redactText(renderError(error)),
  }
}

function cloneBody(
  clone: () => Request | Response,
  maxBytes: number,
  signal: AbortSignal,
  contentType: string | null,
): Promise<TraceBody | undefined> {
  try {
    return readBoundedBody(clone().body, { maxBytes, signal, contentType })
      .catch(error => captureFailure(error))
  } catch (error) {
    return Promise.resolve(captureFailure(error))
  }
}

function captureBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
  contentType: string | null,
): Promise<TraceBody | undefined> {
  return readBoundedBody(body, { maxBytes, signal, contentType })
    .catch(error => captureFailure(error))
}

function defineFetch(
  observed: typeof fetch,
  descriptor: PropertyDescriptor | undefined,
): void {
  Object.defineProperty(globalThis, 'fetch', descriptor === undefined
    ? { value: observed, writable: true, configurable: true }
    : { ...descriptor, value: observed })
}

export function installLlmFetchCapture(
  sink: TraceRecordSink,
  options: LlmFetchCaptureOptions,
): LlmFetchCapture {
  if (!Number.isSafeInteger(options.maxRequestBodyBytes) || options.maxRequestBodyBytes < 1) {
    throw new Error('dsh-trace: maxRequestBodyBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.maxResponseBodyBytes) || options.maxResponseBodyBytes < 1) {
    throw new Error('dsh-trace: maxResponseBodyBytes must be a positive safe integer')
  }

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const original = globalThis.fetch
  if (typeof original !== 'function') throw new Error('dsh-trace: globalThis.fetch is unavailable')
  if (descriptor !== undefined && !('value' in descriptor)) {
    throw new Error('dsh-trace: globalThis.fetch is an accessor and cannot be observed safely')
  }

  const storage = new AsyncLocalStorage<LlmTraceContext>()
  const shutdown = new AbortController()
  const pending = new Set<Promise<void>>()
  const now = options.now ?? Date.now
  const createId = options.createId ?? randomUUID
  let accepting = true

  const track = (task: Promise<void>): void => {
    pending.add(task)
    void task.then(
      () => { pending.delete(task) },
      (error) => {
        pending.delete(task)
        options.onError?.(error)
      },
    )
  }

  const observedFetch: typeof fetch = async (input, init) => {
    const context = accepting ? storage.getStore() : undefined
    if (context === undefined) return Reflect.apply(original, globalThis, [input, init])

    let observedInit = init
    let forwardedInit = init
    if (init?.body instanceof ReadableStream) {
      try {
        const [forwardedBody, observedBody] = init.body.tee()
        forwardedInit = { ...init, body: forwardedBody }
        observedInit = { ...init, body: observedBody }
      } catch {
        // Let native fetch report a locked or otherwise unusable stream.
        return Reflect.apply(original, globalThis, [input, init])
      }
    }

    let request: Request
    try {
      // Constructing from a Request transfers its body in Node's Fetch
      // implementation. Observe a clone so the adapter's original input stays
      // untouched for the real fetch call below.
      request = new Request(input instanceof Request ? input.clone() : input, observedInit)
    } catch {
      // Preserve native fetch behavior if a capture-only descriptor cannot be built.
      return Reflect.apply(original, globalThis, [input, forwardedInit])
    }

    const id = createId()
    const attempt = ++context.nextAttempt
    const startedAt = now()
    const requestBody = captureBody(
      request.body,
      options.maxRequestBodyBytes,
      shutdown.signal,
      request.headers.get('content-type'),
    )

    let response: Response
    try {
      response = await Reflect.apply(original, globalThis, [input, forwardedInit])
    } catch (error) {
      track((async () => {
        const capturedRequestBody = await requestBody
        const completedAt = now()
        await sink.append({
          id,
          logicalRequestId: context.logicalRequestId,
          attempt,
          startedAt,
          completedAt,
          durationMs: Math.max(0, completedAt - startedAt),
          provider: context.provider,
          model: context.model,
          ...context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId },
          ...context.sessionId === undefined ? {} : { sessionId: context.sessionId },
          ...context.purpose === undefined ? {} : { purpose: context.purpose },
          method: request.method,
          url: redactUrl(request.url),
          requestHeaders: redactHeaders(request.headers),
          ...capturedRequestBody === undefined ? {} : { requestBody: capturedRequestBody },
          error: redactText(renderError(error)),
          aborted: request.signal.aborted || isAbortError(error),
        })
      })())
      throw error
    }

    const responseBody = cloneBody(
      () => response.clone(),
      options.maxResponseBodyBytes,
      shutdown.signal,
      response.headers.get('content-type'),
    )
    track((async () => {
      const [capturedRequestBody, capturedResponseBody] = await Promise.all([requestBody, responseBody])
      const completedAt = now()
      await sink.append({
        id,
        logicalRequestId: context.logicalRequestId,
        attempt,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        provider: context.provider,
        model: context.model,
        ...context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId },
        ...context.sessionId === undefined ? {} : { sessionId: context.sessionId },
        ...context.purpose === undefined ? {} : { purpose: context.purpose },
        method: request.method,
        url: redactUrl(request.url),
        requestHeaders: redactHeaders(request.headers),
        ...capturedRequestBody === undefined ? {} : { requestBody: capturedRequestBody },
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseUrl: redactUrl(response.url || request.url),
        responseHeaders: redactHeaders(response.headers),
        ...capturedResponseBody === undefined ? {} : { responseBody: capturedResponseBody },
      })
    })())
    return response
  }

  Object.defineProperty(observedFetch, 'name', { value: original.name, configurable: true })
  Object.defineProperty(observedFetch, 'length', { value: original.length, configurable: true })
  defineFetch(observedFetch, descriptor)

  let stopped: Promise<void> | undefined
  return {
    wrapStream<T>(trace: LlmStreamTrace, next: () => AsyncIterable<T>): AsyncIterable<T> {
      if (!accepting) return next()
      const context: LlmTraceContext = {
        logicalRequestId: createId(),
        provider: trace.provider,
        model: trace.model,
        ...trace.workspaceId === undefined ? {} : { workspaceId: trace.workspaceId },
        ...trace.sessionId === undefined ? {} : { sessionId: trace.sessionId },
        ...trace.purpose === undefined ? {} : { purpose: trace.purpose },
        nextAttempt: 0,
      }
      return (async function* (): AsyncIterable<T> {
        const iterator = storage.run(context, () => next()[Symbol.asyncIterator]())
        let exhausted = false
        try {
          while (true) {
            const item = await storage.run(context, () => iterator.next())
            if (item.done) {
              exhausted = true
              return
            }
            yield item.value
          }
        } finally {
          if (!exhausted && iterator.return !== undefined) {
            await storage.run(context, () => iterator.return!())
          }
        }
      })()
    },
    async flush(): Promise<void> {
      while (pending.size > 0) await Promise.allSettled([...pending])
    },
    stop(): Promise<void> {
      if (stopped !== undefined) return stopped
      stopped = (async () => {
        accepting = false
        const current = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
        if (current !== undefined && 'value' in current && current.value === observedFetch) {
          if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
          else Object.defineProperty(globalThis, 'fetch', descriptor)
        }
        shutdown.abort(new Error('dsh-trace capture stopped'))
        await this.flush()
        storage.disable()
      })()
      return stopped
    },
  }
}
