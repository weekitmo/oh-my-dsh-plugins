export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type TraceBodyFormat = 'json' | 'sse' | 'text' | 'base64'

export interface TraceBody {
  readonly raw: string
  readonly format: TraceBodyFormat
  readonly bytes: number
  readonly truncated: boolean
  readonly parsed?: JsonValue
  readonly captureError?: string
}

export interface TraceRequestRecord {
  readonly id: string
  readonly logicalRequestId: string
  readonly attempt: number
  readonly startedAt: number
  readonly completedAt: number
  readonly durationMs: number
  readonly provider: string
  readonly model: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly purpose?: string
  readonly method: string
  readonly url: string
  readonly requestHeaders: Readonly<Record<string, string>>
  readonly requestBody?: TraceBody
  readonly responseStatus?: number
  readonly responseStatusText?: string
  readonly responseUrl?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseBody?: TraceBody
  readonly error?: string
  readonly aborted?: boolean
}

export interface TraceRequestSummary {
  readonly id: string
  readonly logicalRequestId: string
  readonly attempt: number
  readonly startedAt: number
  readonly completedAt: number
  readonly expiresAt: number
  readonly durationMs: number
  readonly provider: string
  readonly model: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly purpose?: string
  readonly method: string
  readonly url: string
  readonly responseStatus?: number
  readonly error?: string
  readonly aborted?: boolean
  readonly truncated: boolean
}

export interface TraceScope {
  readonly workspaceId?: string
  readonly sessionId: string
}

export interface TraceListQuery extends TraceScope {
  readonly limit: number
  readonly before?: TraceListCursor
}

export interface TraceListCursor {
  readonly startedAt: number
  readonly id: string
}

export interface TraceListResult {
  readonly requests: readonly TraceRequestSummary[]
  readonly hasMore: boolean
}

export interface LlmTraceContext {
  readonly logicalRequestId: string
  readonly provider: string
  readonly model: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly purpose?: string
  nextAttempt: number
}

export function requestSummary(record: TraceRequestRecord): Omit<TraceRequestSummary, 'expiresAt'> {
  return {
    id: record.id,
    logicalRequestId: record.logicalRequestId,
    attempt: record.attempt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    provider: record.provider,
    model: record.model,
    ...record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId },
    ...record.sessionId === undefined ? {} : { sessionId: record.sessionId },
    ...record.purpose === undefined ? {} : { purpose: record.purpose },
    method: record.method,
    url: record.url,
    ...record.responseStatus === undefined ? {} : { responseStatus: record.responseStatus },
    ...record.error === undefined ? {} : { error: record.error },
    ...record.aborted === undefined ? {} : { aborted: record.aborted },
    truncated: record.requestBody?.truncated === true || record.responseBody?.truncated === true,
  }
}
