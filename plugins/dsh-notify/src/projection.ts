import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { NotifyProjectionValue } from './contract.ts'
import type { ResolvedConfig } from './types.ts'

export interface NotifyProjectionState {
  readonly openTurn: {
    readonly turn: number
    readonly text: string
    readonly pendingAsyncDelegations: number
    readonly collectors: Readonly<Record<string, string>>
  } | null
  readonly last: NotifyProjectionValue | null
}

export const EMPTY_PROJECTION: NotifyProjectionValue = Object.freeze({
  turn: 0,
  reason: '',
  body: '',
  startedAsyncDelegation: false,
})

export function boundText(text: string, maxChars: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text
  return characters.slice(0, Math.max(0, maxChars - 1)).join('') + '…'
}

function recordArguments(argumentsText: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const value = JSON.parse(argumentsText) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Readonly<Record<string, unknown>>
      : undefined
  } catch {
    return undefined
  }
}

function runCodeStartsAsync(argumentsValue: Readonly<Record<string, unknown>> | undefined): boolean {
  const code = argumentsValue?.code
  if (typeof code !== 'string') return false
  return /\btools\.(?:bash|subagent|subagent_fork)\s*\([\s\S]{0,12000}?\brun_in_background\s*:\s*true\b/u
    .test(code)
}

export function toolCallStartsAsyncDelegation(name: string, argumentsText: string): boolean {
  if (name === 'de_coi_dispatch' || name === 'create_goal') return true
  const args = recordArguments(argumentsText)
  switch (name) {
    case 'subagent':
    case 'subagent_fork':
      return args?.run_in_background !== false
    case 'bash':
      return args?.run_in_background === true
    case 'de_session':
      return args?.action === 'spawn'
    case 'run_workflow':
      return args?.wait !== true
    case 'update_goal':
      return args?.action === 'resume' || args?.action === 'edit'
    case 'functions.run_code':
      return runCodeStartsAsync(args)
    default:
      return false
  }
}

function collectorName(name: string): string | undefined {
  switch (name) {
    case 'job_output':
    case 'de_coi_wait':
    case 'de_coi_status':
    case 'de_coi_cancel':
      return name
    default:
      return undefined
  }
}

function toolResultText(message: unknown): string {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  const text: string[] = []
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') text.push(record.text)
    if (Array.isArray(record.content)) for (const child of record.content) visit(child)
  }
  for (const block of content) visit(block)
  return text.join('\n')
}

function collectorSettled(name: string, message: unknown): boolean {
  const text = toolResultText(message)
  if (name === 'job_output') {
    return /\[status:\s*(?:completed|failed|killed)\b/iu.test(text)
  }
  return /(?:status|任务[^：\n]*：)\s*(?:completed|failed|killed|interrupted)\b/iu.test(text)
}

export function turnHasUnsettledAsyncDelegation(
  events: readonly SessionEvent[],
  turn: number,
): boolean {
  let pending = 0
  const collectors = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.turn === turn) {
      if (toolCallStartsAsyncDelegation(event.data.name, event.data.arguments)) pending += 1
      const collector = collectorName(event.data.name)
      if (collector !== undefined) collectors.set(String(event.data.callId), collector)
      continue
    }
    if (event.type !== 'tool/result' || event.data.turn !== turn) continue
    const callId = String(event.data.message.content[0].toolCallId)
    const collector = collectors.get(callId)
    if (collector === undefined) continue
    collectors.delete(callId)
    if (collectorSettled(collector, event.data.message)) pending = Math.max(0, pending - 1)
  }
  return pending > 0
}

export function applyProjectionEvent(
  state: NotifyProjectionState,
  event: SessionEvent,
  maxChars: number,
): NotifyProjectionState {
  switch (event.type) {
    case 'turn/start':
      return {
        ...state,
        openTurn: { turn: event.data.turn, text: '', pendingAsyncDelegations: 0, collectors: {} },
      }
    case 'assistant/message': {
      const open = state.openTurn
      if (open === null || open.turn !== event.data.turn) return state
      let text = open.text
      for (const block of event.data.message.content) {
        if (block.type === 'text') text += block.text
      }
      text = boundText(text, maxChars)
      return text === open.text ? state : { ...state, openTurn: { ...open, text } }
    }
    case 'tool/call': {
      const open = state.openTurn
      if (open === null || open.turn !== event.data.turn) return state
      const startsAsync = toolCallStartsAsyncDelegation(event.data.name, event.data.arguments)
      const collector = collectorName(event.data.name)
      if (!startsAsync && collector === undefined) return state
      return {
        ...state,
        openTurn: {
          ...open,
          pendingAsyncDelegations: open.pendingAsyncDelegations + (startsAsync ? 1 : 0),
          collectors: collector === undefined
            ? open.collectors
            : { ...open.collectors, [String(event.data.callId)]: collector },
        },
      }
    }
    case 'tool/result': {
      const open = state.openTurn
      if (open === null || open.turn !== event.data.turn) return state
      const callId = String(event.data.message.content[0].toolCallId)
      const collector = open.collectors[callId]
      if (collector === undefined) return state
      const collectors = { ...open.collectors }
      delete collectors[callId]
      const pendingAsyncDelegations = collectorSettled(collector, event.data.message)
        ? Math.max(0, open.pendingAsyncDelegations - 1)
        : open.pendingAsyncDelegations
      return { ...state, openTurn: { ...open, collectors, pendingAsyncDelegations } }
    }
    case 'turn/end': {
      const open = state.openTurn
      if (open === null || open.turn !== event.data.turn) return state
      return {
        openTurn: null,
        last: {
          turn: event.data.turn,
          reason: event.data.reason.kind,
          body: open.text.trim(),
          startedAsyncDelegation: open.pendingAsyncDelegations > 0,
        },
      }
    }
    default:
      return state
  }
}

export function notifyProjection(config: ResolvedConfig): ProjectionDefinition<'dshNotify', NotifyProjectionState> {
  return {
    key: 'dshNotify',
    schema: z.object({
      turn: z.number().int().nonnegative(),
      reason: z.string(),
      body: z.string(),
      startedAsyncDelegation: z.boolean(),
    }).strict(),
    init: () => ({ openTurn: null, last: null }),
    apply: (state, event) => applyProjectionEvent(state, event, config.maxBodyChars),
    view: state => state.last ?? EMPTY_PROJECTION,
    stateVersion: 2,
  }
}
