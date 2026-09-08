import type { JsonValue, TraceBody, TraceBodyFormat } from './types.ts'

export const REDACTED = '[REDACTED]'

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
])

const SENSITIVE_KEY = /(?:^|[_-])(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|apikey|secret|password|credential)(?:$|[_-])/i
const SENSITIVE_QUERY_KEY = /^(?:access_token|refresh_token|token|api_key|apikey|key|secret|password|credential)$/i

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value.map(jsonValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : jsonValue(item),
      ]),
    )
  }
  return String(value)
}

export function redactJson(value: unknown): JsonValue {
  return jsonValue(value)
}

export function redactHeaders(headers: Headers): Readonly<Record<string, string>> {
  return Object.fromEntries([...headers.entries()].map(([name, value]) => [
    name,
    SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : redactText(value),
  ]))
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, REDACTED)
    }
    return url.toString()
  } catch {
    return redactText(raw)
  }
}

export function redactText(raw: string): string {
  return raw
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|apikey|secret|password|credential)\s*[=:]\s*)(["']?)([^\s,"';&]+|[^"']*)(\2)/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`,
    )
    .replace(/((?:authorization|proxy-authorization)\s*[=:]\s*)([^\r\n,;]+)/gi, `$1${REDACTED}`)
}

function jsonBody(raw: string): { raw: string; parsed: JsonValue } | undefined {
  try {
    const parsed = redactJson(JSON.parse(raw) as unknown)
    return { raw: JSON.stringify(parsed), parsed }
  } catch {
    return undefined
  }
}

function sseBody(raw: string): { raw: string; parsed?: JsonValue } {
  const parsed: JsonValue[] = []
  const lines = raw.split(/\r?\n/).map((line) => {
    if (!line.startsWith('data:')) return redactText(line)
    const prefix = line.slice(0, 5)
    const spacing = /^\s*/.exec(line.slice(5))?.[0] ?? ''
    const data = line.slice(5 + spacing.length)
    if (data === '[DONE]') return line
    const json = jsonBody(data)
    if (json === undefined) return `${prefix}${spacing}${redactText(data)}`
    parsed.push(json.parsed)
    return `${prefix}${spacing}${json.raw}`
  })
  return {
    raw: lines.join('\n'),
    ...parsed.length === 0 ? {} : { parsed },
  }
}

export function redactCapturedBody(
  raw: string,
  format: TraceBodyFormat,
  bytes: number,
  truncated: boolean,
  captureError?: string,
): TraceBody {
  if (format === 'base64') {
    return {
      raw,
      format,
      bytes,
      truncated,
      ...captureError === undefined ? {} : { captureError: redactText(captureError) },
    }
  }
  if (format === 'sse') {
    const redacted = sseBody(raw)
    return {
      raw: redacted.raw,
      format,
      bytes,
      truncated,
      ...redacted.parsed === undefined ? {} : { parsed: redacted.parsed },
      ...captureError === undefined ? {} : { captureError: redactText(captureError) },
    }
  }
  const structured = format === 'json' ? jsonBody(raw) : undefined
  return {
    raw: structured?.raw ?? redactText(raw),
    format,
    bytes,
    truncated,
    ...structured?.parsed === undefined ? {} : { parsed: structured.parsed },
    ...captureError === undefined ? {} : { captureError: redactText(captureError) },
  }
}
