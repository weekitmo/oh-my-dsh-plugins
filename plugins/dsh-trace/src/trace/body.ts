import { redactCapturedBody } from './redaction.ts'
import type { TraceBody, TraceBodyFormat } from './types.ts'

export interface BodyReadOptions {
  readonly maxBytes: number
  readonly signal: AbortSignal
  readonly contentType?: string | null
}

function bodyFormat(contentType: string | null | undefined): TraceBodyFormat {
  const mime = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mime === 'text/event-stream') return 'sse'
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json'
  if (
    mime.startsWith('text/')
    || mime === 'application/xml'
    || mime.endsWith('+xml')
    || mime === 'application/x-www-form-urlencoded'
    || mime === 'application/graphql'
    || mime === ''
  ) return 'text'
  return 'base64'
}

function renderError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return String(error)
  } catch {
    return 'unrenderable body capture error'
  }
}

function hasCompleteSseDoneEvent(raw: string): boolean {
  const events = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n\n')
  // The final split item is an unterminated tail. SSE dispatches an event only
  // after its blank-line delimiter, so it must not count as a complete DONE.
  for (const event of events.slice(0, -1)) {
    const data = event.split('\n').flatMap((line) => {
      if (!line.startsWith('data:')) return []
      const value = line.slice(5)
      return [value.startsWith(' ') ? value.slice(1) : value]
    })
    if (data.join('\n') === '[DONE]') return true
  }
  return false
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  options: BodyReadOptions,
): Promise<TraceBody | undefined> {
  if (body === null) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  let bodyLimitReached = false
  const abort = (): void => { void reader.cancel(options.signal.reason).catch(() => undefined) }
  options.signal.addEventListener('abort', abort, { once: true })
  let captureError: string | undefined
  try {
    while (!options.signal.aborted) {
      const item = await reader.read()
      if (item.done) break
      const remaining = options.maxBytes - bytes
      if (remaining <= 0) {
        truncated = true
        bodyLimitReached = true
        await reader.cancel('dsh-trace body limit reached').catch(() => undefined)
        break
      }
      const chunk = item.value.byteLength <= remaining ? item.value : item.value.subarray(0, remaining)
      chunks.push(chunk)
      bytes += chunk.byteLength
      if (chunk.byteLength < item.value.byteLength) {
        truncated = true
        bodyLimitReached = true
        await reader.cancel('dsh-trace body limit reached').catch(() => undefined)
        break
      }
    }
    if (options.signal.aborted) captureError = 'capture stopped before the body completed'
  } catch (error) {
    truncated = true
    captureError = renderError(error)
  } finally {
    options.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
  const format = bodyFormat(options.contentType)
  const raw = format === 'base64' ? buffer.toString('base64') : new TextDecoder().decode(buffer)
  if (format === 'sse' && !bodyLimitReached && hasCompleteSseDoneEvent(raw)) {
    // Some adapters abort their transport after consuming [DONE]. A cloned
    // response reader can observe that teardown even though the SSE response
    // was already semantically complete.
    truncated = false
    captureError = undefined
  }
  return redactCapturedBody(raw, format, bytes, truncated, captureError)
}
