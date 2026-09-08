import type { TraceRequestRecord } from '../src/trace/types.ts'

export function record(
  id: string,
  startedAt: number,
  overrides: Partial<TraceRequestRecord> = {},
): TraceRequestRecord {
  return {
    id,
    logicalRequestId: `logical-${id}`,
    attempt: 1,
    startedAt,
    completedAt: startedAt + 25,
    durationMs: 25,
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 'session-a',
    method: 'POST',
    url: 'https://api.example/v1/chat/completions',
    requestHeaders: { 'content-type': 'application/json' },
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    ...overrides,
  }
}
