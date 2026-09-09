import { StringDecoder } from 'node:string_decoder'
import type { AdapterId, DelegateEvent } from '../types.ts'

export interface ProtocolSnapshot {
  readonly events: readonly DelegateEvent[]
  readonly finalText?: string
  readonly externalSessionId?: string
  readonly diagnostics: readonly string[]
}

interface MutableSnapshot {
  events: DelegateEvent[]
  finalText?: string
  externalSessionId?: string
  diagnostics: string[]
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const parts = value.flatMap((part) => {
    const row = object(part)
    const text = row?.['text']
    return typeof text === 'string' ? [text] : []
  })
  return parts.length === 0 ? undefined : parts.join('')
}

function sessionId(value: Record<string, unknown>): string | undefined {
  if (value['type'] === 'session' && typeof value['id'] === 'string' && value['id'].length > 0) return value['id']
  for (const key of ['sessionId', 'session_id', 'thread_id', 'threadId']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  const session = object(value['session'])
  return session === undefined ? undefined : sessionId(session)
}

export class ProtocolParser {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private sequence = 0
  private readonly state: MutableSnapshot = { events: [], diagnostics: [] }

  constructor(
    private readonly adapterId: AdapterId,
    private readonly maxEvents: number,
    private readonly maxPendingBytes = 1024 * 1024,
  ) {}

  push(chunk: Buffer | string): void {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    if (Buffer.byteLength(this.pending) > this.maxPendingBytes) {
      this.diagnostic('protocol line exceeded the configured decoder limit')
      this.pending = ''
      return
    }
    let newline = this.pending.indexOf('\n')
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).trimEnd()
      this.pending = this.pending.slice(newline + 1)
      if (line.trim() !== '') this.parseLine(line)
      newline = this.pending.indexOf('\n')
    }
  }

  finish(): ProtocolSnapshot {
    this.pending += this.decoder.end()
    const tail = this.pending.trim()
    if (tail !== '') this.parseLine(tail)
    this.pending = ''
    return this.snapshot()
  }

  snapshot(): ProtocolSnapshot {
    return {
      events: [...this.state.events],
      ...(this.state.finalText === undefined ? {} : { finalText: this.state.finalText }),
      ...(this.state.externalSessionId === undefined ? {} : { externalSessionId: this.state.externalSessionId }),
      diagnostics: [...this.state.diagnostics],
    }
  }

  private parseLine(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      this.diagnostic(`non-JSON protocol line: ${line.slice(0, 240)}`)
      return
    }
    const row = object(value)
    if (row === undefined) {
      this.diagnostic('protocol event was not a JSON object')
      return
    }
    const discovered = sessionId(row)
    if (discovered !== undefined && discovered !== this.state.externalSessionId) {
      this.state.externalSessionId = discovered
      this.event('session', undefined, undefined, { id: discovered })
    }
    this.adapterId === 'pi'
      ? this.parsePi(row)
      : this.adapterId === 'codex'
        ? this.parseCodex(row)
        : this.parseGrok(row)
  }

  private parsePi(row: Record<string, unknown>): void {
    const type = row['type']
    const message = object(row['message'])
    if ((type === 'message_end' || type === 'message_update') && message?.['role'] === 'assistant') {
      const text = textContent(message['content'])
      if (text !== undefined) {
        this.state.finalText = text
        if (type === 'message_end') this.event('assistant', text)
      }
    }
    if (type === 'tool_execution_start') {
      this.event('tool', undefined, typeof row['toolName'] === 'string' ? row['toolName'] : undefined)
    }
    if (type === 'agent_end') {
      const messages = Array.isArray(row['messages']) ? row['messages'] : []
      const assistant = [...messages].reverse().map(object).find(candidate => candidate?.['role'] === 'assistant')
      const text = textContent(assistant?.['content'])
      if (text !== undefined) this.state.finalText = text
    }
  }

  private parseCodex(row: Record<string, unknown>): void {
    const type = row['type']
    const item = object(row['item'])
    if (type === 'item.completed' && item?.['type'] === 'agent_message') {
      const text = textContent(item['text'] ?? item['content'])
      if (text !== undefined) {
        this.state.finalText = text
        this.event('assistant', text)
      }
    }
    if ((type === 'item.started' || type === 'item.completed') && typeof item?.['type'] === 'string' && item['type'] !== 'agent_message') {
      this.event('tool', undefined, String(item['type']))
    }
    if (type === 'turn.completed') {
      const usage = object(row['usage'])
      if (usage !== undefined) this.event('usage', undefined, undefined, usage)
    }
  }

  private parseGrok(row: Record<string, unknown>): void {
    const update = object(row['update']) ?? row
    const type = update['sessionUpdate'] ?? update['type']
    const content = object(update['content'])
    const text = textContent(content?.['text'] ?? update['text'] ?? update['message'])
    if ((type === 'agent_message_chunk' || type === 'assistant' || type === 'message') && text !== undefined) {
      this.state.finalText = type === 'agent_message_chunk'
        ? `${this.state.finalText ?? ''}${text}`
        : text
      this.event('assistant', text)
    }
    if (type === 'tool_call' || type === 'tool_call_update') {
      const name = update['title'] ?? update['name']
      this.event('tool', undefined, typeof name === 'string' ? name : undefined)
    }
    const usage = object(update['usage'])
    if (usage !== undefined) this.event('usage', undefined, undefined, usage)
  }

  private diagnostic(message: string): void {
    if (this.state.diagnostics.length < 20) this.state.diagnostics.push(message)
    this.event('diagnostic', message)
  }

  private event(
    type: DelegateEvent['type'],
    text?: string,
    name?: string,
    data?: Readonly<Record<string, unknown>>,
  ): void {
    if (this.state.events.length >= this.maxEvents) return
    this.state.events.push({
      sequence: ++this.sequence,
      at: Date.now(),
      type,
      ...(text === undefined ? {} : { text }),
      ...(name === undefined ? {} : { name }),
      ...(data === undefined ? {} : { data }),
    })
  }
}
