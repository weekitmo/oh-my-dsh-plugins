import type { JsonValue, TraceBody } from '../trace/types.ts'

export type ConversationRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'
export type ConversationPhase = 'request' | 'response'

export interface ConversationToolCall {
  readonly id?: string
  readonly name: string
  readonly arguments: string
}

export interface ConversationAttachment {
  readonly kind: 'image' | 'audio' | 'file'
  readonly label?: string
}

export interface ConversationMessage {
  readonly index: number
  readonly phase: ConversationPhase
  readonly role: ConversationRole
  readonly content: string
  readonly reasoning?: string
  readonly toolCalls?: readonly ConversationToolCall[]
  readonly toolCallId?: string
  readonly attachments?: readonly ConversationAttachment[]
  readonly raw: JsonValue
}

export interface ConversationTool {
  readonly name: string
  readonly description: string
  readonly parameters: JsonValue
}

export interface TraceConversation {
  readonly protocol: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'generic'
  readonly model?: string
  readonly stream?: boolean
  readonly messages: readonly ConversationMessage[]
  readonly tools: readonly ConversationTool[]
}

type ObjectValue = { [key: string]: JsonValue }

interface ContentResult {
  content: string
  reasoning?: string
  toolCalls?: ConversationToolCall[]
  toolResults?: Array<{ id?: string; content: string; raw: JsonValue }>
  attachments?: ConversationAttachment[]
}

interface RequestConversation {
  protocol: TraceConversation['protocol']
  model?: string
  stream?: boolean
  messages: ConversationMessage[]
  tools: ConversationTool[]
}

function object(value: JsonValue | undefined): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectValue
    : undefined
}

function text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function pretty(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value) as JsonValue, null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function roleOf(value: JsonValue | undefined, fallback: ConversationRole): ConversationRole {
  if (value === 'system' || value === 'developer' || value === 'user'
    || value === 'assistant' || value === 'tool') return value
  if (value === 'model') return 'assistant'
  return fallback
}

function attachment(kind: ConversationAttachment['kind'], value: JsonValue | undefined): ConversationAttachment {
  const source = object(value)
  const url = object(source?.['image_url'])?.['url'] ?? source?.['url'] ?? source?.['file_id']
  const label = typeof url === 'string' ? url.slice(0, 160) : undefined
  return { kind, ...label === undefined ? {} : { label } }
}

function normalizeOpenAiToolCalls(value: JsonValue | undefined): ConversationToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined
  const calls = value.flatMap((candidate): ConversationToolCall[] => {
    const call = object(candidate)
    const fn = object(call?.['function'])
    const name = text(fn?.['name'] ?? call?.['name'])
    if (name === '') return []
    const id = text(call?.['id'] ?? call?.['call_id'])
    return [{
      ...id === '' ? {} : { id },
      name,
      arguments: pretty(fn?.['arguments'] ?? call?.['arguments']),
    }]
  })
  return calls.length === 0 ? undefined : calls
}

function openAiContent(value: JsonValue | undefined): ContentResult {
  if (typeof value === 'string') return { content: value }
  if (!Array.isArray(value)) return { content: '' }
  let content = ''
  let reasoning = ''
  const attachments: ConversationAttachment[] = []
  for (const candidate of value) {
    if (typeof candidate === 'string') {
      content += candidate
      continue
    }
    const part = object(candidate)
    const type = text(part?.['type'])
    if (type === 'text' || type === 'input_text' || type === 'output_text' || type === 'summary_text') {
      content += text(part?.['text'])
    } else if (type === 'reasoning' || type === 'thinking' || type === 'reasoning_text') {
      reasoning += text(part?.['text'] ?? part?.['thinking'])
    } else if (type === 'image' || type === 'image_url' || type === 'input_image') {
      attachments.push(attachment('image', candidate))
    } else if (type === 'audio' || type === 'input_audio') {
      attachments.push(attachment('audio', candidate))
    } else if (type === 'file' || type === 'input_file') {
      attachments.push(attachment('file', candidate))
    }
  }
  return {
    content,
    ...reasoning === '' ? {} : { reasoning },
    ...attachments.length === 0 ? {} : { attachments },
  }
}

function anthropicContent(value: JsonValue | undefined): ContentResult {
  if (typeof value === 'string') return { content: value }
  if (!Array.isArray(value)) return { content: '' }
  let content = ''
  let reasoning = ''
  const toolCalls: ConversationToolCall[] = []
  const toolResults: NonNullable<ContentResult['toolResults']> = []
  const attachments: ConversationAttachment[] = []
  for (const candidate of value) {
    const block = object(candidate)
    if (block === undefined) {
      content += text(candidate)
      continue
    }
    const type = text(block['type'])
    if (type === 'text') content += text(block['text'])
    else if (type === 'thinking') reasoning += text(block['thinking'])
    else if (type === 'redacted_thinking') reasoning += text(block['data'])
    else if (type === 'tool_use' || type.endsWith('_tool_use')) {
      const id = text(block['id'])
      toolCalls.push({
        ...id === '' ? {} : { id },
        name: text(block['name']) || 'unknown',
        arguments: pretty(block['input']),
      })
    } else if (type === 'tool_result') {
      const id = text(block['tool_use_id'])
      toolResults.push({
        ...id === '' ? {} : { id },
        content: pretty(block['content']),
        raw: candidate,
      })
    } else if (type === 'image') attachments.push(attachment('image', candidate))
    else if (type === 'document') attachments.push(attachment('file', candidate))
  }
  return {
    content,
    ...reasoning === '' ? {} : { reasoning },
    ...toolCalls.length === 0 ? {} : { toolCalls },
    ...toolResults.length === 0 ? {} : { toolResults },
    ...attachments.length === 0 ? {} : { attachments },
  }
}

function geminiContent(value: JsonValue | undefined): ContentResult {
  if (!Array.isArray(value)) return { content: '' }
  let content = ''
  let reasoning = ''
  const toolCalls: ConversationToolCall[] = []
  const toolResults: NonNullable<ContentResult['toolResults']> = []
  const attachments: ConversationAttachment[] = []
  for (const candidate of value) {
    const part = object(candidate)
    if (part === undefined) continue
    if (typeof part['text'] === 'string') {
      if (part['thought'] === true) reasoning += part['text']
      else content += part['text']
      continue
    }
    const call = object(part['functionCall'])
    if (call !== undefined) {
      const id = text(call['id'])
      toolCalls.push({
        ...id === '' ? {} : { id },
        name: text(call['name']) || 'unknown',
        arguments: pretty(call['args']),
      })
      continue
    }
    const result = object(part['functionResponse'])
    if (result !== undefined) {
      const id = text(result['id'] ?? result['name'])
      toolResults.push({
        ...id === '' ? {} : { id },
        content: pretty(result['response']),
        raw: candidate,
      })
      continue
    }
    if (part['inlineData'] !== undefined || part['fileData'] !== undefined) {
      attachments.push(attachment('file', candidate))
    }
  }
  return {
    content,
    ...reasoning === '' ? {} : { reasoning },
    ...toolCalls.length === 0 ? {} : { toolCalls },
    ...toolResults.length === 0 ? {} : { toolResults },
    ...attachments.length === 0 ? {} : { attachments },
  }
}

function addMessage(
  messages: ConversationMessage[],
  phase: ConversationPhase,
  role: ConversationRole,
  parsed: ContentResult,
  raw: JsonValue,
  extras: { toolCalls?: readonly ConversationToolCall[]; toolCallId?: string } = {},
): void {
  const toolCalls = extras.toolCalls ?? parsed.toolCalls
  if (parsed.content !== '' || parsed.reasoning !== undefined || toolCalls !== undefined
    || parsed.attachments !== undefined || role === 'system' || role === 'developer') {
    messages.push({
      index: messages.length,
      phase,
      role,
      content: parsed.content,
      ...parsed.reasoning === undefined ? {} : { reasoning: parsed.reasoning },
      ...toolCalls === undefined ? {} : { toolCalls },
      ...extras.toolCallId === undefined ? {} : { toolCallId: extras.toolCallId },
      ...parsed.attachments === undefined ? {} : { attachments: parsed.attachments },
      raw,
    })
  }
  for (const result of parsed.toolResults ?? []) {
    messages.push({
      index: messages.length,
      phase,
      role: 'tool',
      content: result.content,
      ...result.id === undefined ? {} : { toolCallId: result.id },
      raw: result.raw,
    })
  }
}

function openAiTools(value: JsonValue | undefined): ConversationTool[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): ConversationTool[] => {
    const tool = object(candidate)
    const fn = object(tool?.['function']) ?? tool
    const name = text(fn?.['name'])
    if (name === '') return []
    return [{
      name,
      description: text(fn?.['description']),
      parameters: fn?.['parameters'] ?? {},
    }]
  })
}

function anthropicTools(value: JsonValue | undefined): ConversationTool[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): ConversationTool[] => {
    const tool = object(candidate)
    const name = text(tool?.['name'])
    if (name === '') return []
    return [{
      name,
      description: text(tool?.['description']),
      parameters: tool?.['input_schema'] ?? {},
    }]
  })
}

function geminiTools(value: JsonValue | undefined): ConversationTool[] {
  if (!Array.isArray(value)) return []
  const tools: ConversationTool[] = []
  for (const candidate of value) {
    const declarations = object(candidate)?.['functionDeclarations']
    if (!Array.isArray(declarations)) continue
    for (const item of declarations) {
      const declaration = object(item)
      const name = text(declaration?.['name'])
      if (name === '') continue
      tools.push({
        name,
        description: text(declaration?.['description']),
        parameters: declaration?.['parameters'] ?? {},
      })
    }
  }
  return tools
}

function parseRequest(value: JsonValue | undefined): RequestConversation | undefined {
  const body = object(value)
  if (body === undefined) return undefined
  const messages: ConversationMessage[] = []
  const model = typeof body['model'] === 'string' ? body['model'] : undefined
  const stream = typeof body['stream'] === 'boolean' ? body['stream'] : undefined

  if (Array.isArray(body['contents'])) {
    const instruction = object(body['systemInstruction'])?.['parts']
    const system = geminiContent(instruction)
    if (system.content !== '') addMessage(messages, 'request', 'system', system, body['systemInstruction'] ?? {})
    for (const candidate of body['contents']) {
      const entry = object(candidate)
      if (entry === undefined) continue
      addMessage(messages, 'request', roleOf(entry['role'], 'user'), geminiContent(entry['parts']), candidate)
    }
    if (messages.length === 0) return undefined
    return { protocol: 'gemini', ...model === undefined ? {} : { model }, ...stream === undefined ? {} : { stream }, messages, tools: geminiTools(body['tools']) }
  }

  const anthropic = body['system'] !== undefined || Array.isArray(body['messages'])
    && body['messages'].some((candidate) => Array.isArray(object(candidate)?.['content'])
      && (object(candidate)?.['content'] as JsonValue[]).some(part => {
        const type = text(object(part)?.['type'])
        return type === 'thinking' || type === 'tool_use' || type === 'tool_result' || type === 'redacted_thinking'
      }))
  if (anthropic && Array.isArray(body['messages'])) {
    const system = typeof body['system'] === 'string'
      ? { content: body['system'] }
      : anthropicContent(body['system'])
    if (system.content !== '') addMessage(messages, 'request', 'system', system, body['system'] ?? '')
    for (const candidate of body['messages']) {
      const entry = object(candidate)
      if (entry === undefined) continue
      addMessage(messages, 'request', roleOf(entry['role'], 'user'), anthropicContent(entry['content']), candidate)
    }
    if (messages.length === 0) return undefined
    return { protocol: 'anthropic', ...model === undefined ? {} : { model }, ...stream === undefined ? {} : { stream }, messages, tools: anthropicTools(body['tools']) }
  }

  if (body['input'] !== undefined && !Array.isArray(body['messages'])) {
    const input = Array.isArray(body['input']) ? body['input'] : [{ role: 'user', content: body['input'] } as JsonValue]
    for (const candidate of input) {
      const entry = object(candidate)
      if (entry === undefined) continue
      const type = text(entry['type'])
      if (type === 'function_call') {
        const toolCalls = normalizeOpenAiToolCalls([entry])
        addMessage(messages, 'request', 'assistant', { content: '' }, candidate, {
          ...toolCalls === undefined ? {} : { toolCalls },
        })
      } else if (type === 'function_call_output') {
        const id = text(entry['call_id'])
        addMessage(messages, 'request', 'tool', { content: pretty(entry['output']) }, candidate, {
          ...id === '' ? {} : { toolCallId: id },
        })
      } else {
        addMessage(messages, 'request', roleOf(entry['role'], 'user'), openAiContent(entry['content']), candidate)
      }
    }
    if (messages.length === 0) return undefined
    return { protocol: 'openai-responses', ...model === undefined ? {} : { model }, ...stream === undefined ? {} : { stream }, messages, tools: openAiTools(body['tools']) }
  }

  if (Array.isArray(body['messages'])) {
    for (const candidate of body['messages']) {
      const entry = object(candidate)
      if (entry === undefined) continue
      const id = text(entry['tool_call_id'])
      const parsed = openAiContent(entry['content'])
      const reasoning = text(entry['reasoning_content'] ?? entry['reasoning'])
      const toolCalls = normalizeOpenAiToolCalls(entry['tool_calls'])
      addMessage(messages, 'request', roleOf(entry['role'], 'user'), {
        ...parsed,
        ...reasoning === '' ? {} : { reasoning },
      }, candidate, {
        ...toolCalls === undefined ? {} : { toolCalls },
        ...id === '' ? {} : { toolCallId: id },
      })
    }
    if (messages.length === 0) return undefined
    return { protocol: 'openai-chat', ...model === undefined ? {} : { model }, ...stream === undefined ? {} : { stream }, messages, tools: openAiTools(body['tools']) }
  }
  return undefined
}

function parseFinalResponse(value: JsonValue, protocol: TraceConversation['protocol']): ContentResult | undefined {
  const body = object(value)
  if (body === undefined) return undefined
  const nestedResponse = object(body['response'])
  if (nestedResponse !== undefined && Array.isArray(nestedResponse['output'])) {
    return parseFinalResponse(nestedResponse, 'openai-responses')
  }
  if (Array.isArray(body['output'])) {
    let content = ''
    let reasoning = ''
    const toolCalls: ConversationToolCall[] = []
    const attachments: ConversationAttachment[] = []
    for (const candidate of body['output']) {
      const item = object(candidate)
      if (item === undefined) continue
      const type = text(item['type'])
      if (type === 'message') {
        const parsed = openAiContent(item['content'])
        content += parsed.content
        reasoning += parsed.reasoning ?? ''
        attachments.push(...parsed.attachments ?? [])
      } else if (type === 'reasoning') {
        const summary = openAiContent(item['summary'])
        reasoning += summary.content || summary.reasoning || ''
      } else if (type === 'function_call') {
        toolCalls.push(...normalizeOpenAiToolCalls([item]) ?? [])
      }
    }
    if (content !== '' || reasoning !== '' || toolCalls.length > 0 || attachments.length > 0) {
      return {
        content,
        ...reasoning === '' ? {} : { reasoning },
        ...toolCalls.length === 0 ? {} : { toolCalls },
        ...attachments.length === 0 ? {} : { attachments },
      }
    }
  }
  if (Array.isArray(body['choices'])) {
    const first = object(body['choices'][0])
    const message = object(first?.['message'])
    if (message !== undefined) {
      const parsed = openAiContent(message['content'])
      const reasoning = text(message['reasoning_content'] ?? message['reasoning'])
      const toolCalls = normalizeOpenAiToolCalls(message['tool_calls'])
      return {
        ...parsed,
        ...reasoning === '' ? {} : { reasoning },
        ...toolCalls === undefined ? {} : { toolCalls },
      }
    }
    if (typeof first?.['text'] === 'string') return { content: first['text'] }
  }
  if (Array.isArray(body['candidates'])) {
    const parts = object(body['candidates'][0])?.['content']
    const parsed = geminiContent(object(parts)?.['parts'])
    if (parsed.content !== '' || parsed.reasoning !== undefined || parsed.toolCalls !== undefined) return parsed
  }
  if (body['role'] === 'assistant' && body['content'] !== undefined || protocol === 'anthropic' && Array.isArray(body['content'])) {
    const parsed = anthropicContent(body['content'])
    if (parsed.content !== '' || parsed.reasoning !== undefined || parsed.toolCalls !== undefined) return parsed
  }
  if (Array.isArray(body['parts'])) {
    const parsed = openAiContent(body['parts'])
    if (parsed.content !== '' || parsed.reasoning !== undefined) return parsed
  }
  if (typeof body['content'] === 'string') return { content: body['content'] }
  return undefined
}

function parseStream(events: readonly JsonValue[]): ContentResult | undefined {
  let content = ''
  let reasoning = ''
  const openAiTools = new Map<number, { id?: string; name: string; arguments: string }>()
  const responseTools = new Map<string, { id?: string; name: string; arguments: string }>()
  const anthropicBlocks = new Map<number, { type: string; id?: string; name?: string; content: string }>()
  let final: ContentResult | undefined

  for (const eventValue of events) {
    const event = object(eventValue)
    if (event === undefined) continue
    const eventType = text(event['type'])
    if (eventType === 'response.completed' || eventType === 'response.done') {
      final = parseFinalResponse(eventValue, 'openai-responses') ?? final
      continue
    }
    if (eventType === 'response.output_text.delta') content += text(event['delta'])
    else if (eventType === 'response.reasoning_summary_text.delta' || eventType === 'response.reasoning_text.delta') reasoning += text(event['delta'])
    else if (eventType === 'response.output_item.added') {
      const item = object(event['item'])
      if (item?.['type'] === 'function_call') {
        const key = text(item['id'] ?? item['call_id']) || String(responseTools.size)
        responseTools.set(key, {
          ...text(item['call_id'] ?? item['id']) === '' ? {} : { id: text(item['call_id'] ?? item['id']) },
          name: text(item['name']) || 'unknown',
          arguments: text(item['arguments']),
        })
      }
    } else if (eventType === 'response.function_call_arguments.delta') {
      const key = text(event['item_id'] ?? event['call_id'])
      const call = responseTools.get(key) ?? { name: text(event['name']) || 'unknown', arguments: '' }
      call.arguments += text(event['delta'])
      responseTools.set(key || String(responseTools.size), call)
    }

    if (eventType === 'content_block_start') {
      const index = typeof event['index'] === 'number' ? event['index'] : 0
      const block = object(event['content_block'])
      anthropicBlocks.set(index, {
        type: text(block?.['type']) || 'text',
        ...text(block?.['id']) === '' ? {} : { id: text(block?.['id']) },
        ...text(block?.['name']) === '' ? {} : { name: text(block?.['name']) },
        content: '',
      })
    } else if (eventType === 'content_block_delta') {
      const index = typeof event['index'] === 'number' ? event['index'] : 0
      const delta = object(event['delta'])
      const deltaType = text(delta?.['type'])
      const block = anthropicBlocks.get(index) ?? {
        type: deltaType === 'thinking_delta' ? 'thinking' : deltaType === 'input_json_delta' ? 'tool_use' : 'text',
        content: '',
      }
      if (deltaType === 'thinking_delta' || deltaType === 'signature_delta') block.content += text(delta?.['thinking'])
      else if (deltaType === 'input_json_delta') block.content += text(delta?.['partial_json'])
      else block.content += text(delta?.['text'])
      anthropicBlocks.set(index, block)
    }

    const choices = event['choices']
    if (Array.isArray(choices)) {
      for (const choiceValue of choices) {
        const choice = object(choiceValue)
        const delta = object(choice?.['delta'])
        if (delta === undefined) {
          content += text(choice?.['text'])
          continue
        }
        content += text(delta['content'])
        reasoning += text(delta['reasoning_content'] ?? delta['reasoning'])
        const calls = delta['tool_calls']
        if (!Array.isArray(calls)) continue
        for (const candidate of calls) {
          const call = object(candidate)
          const index = typeof call?.['index'] === 'number' ? call['index'] : 0
          const fn = object(call?.['function'])
          const current = openAiTools.get(index) ?? { name: '', arguments: '' }
          const id = text(call?.['id'])
          if (id !== '') current.id = id
          current.name += text(fn?.['name'])
          current.arguments += text(fn?.['arguments'])
          openAiTools.set(index, current)
        }
      }
    }
    if (eventType === 'text-delta') content += text(event['delta'])
    if (eventType === 'reasoning-delta') reasoning += text(event['delta'])
    if (Array.isArray(event['candidates'])) {
      const parsed = geminiContent(object(object(event['candidates'][0])?.['content'])?.['parts'])
      content += parsed.content
      reasoning += parsed.reasoning ?? ''
      for (const [index, call] of (parsed.toolCalls ?? []).entries()) {
        openAiTools.set(openAiTools.size + index, { ...call, arguments: call.arguments })
      }
    }
  }
  if (final !== undefined) return final
  const toolCalls: ConversationToolCall[] = []
  for (const [, call] of [...openAiTools].sort(([left], [right]) => left - right)) {
    toolCalls.push({ ...call.id === undefined ? {} : { id: call.id }, name: call.name || 'unknown', arguments: call.arguments })
  }
  for (const call of responseTools.values()) toolCalls.push(call)
  for (const [, block] of [...anthropicBlocks].sort(([left], [right]) => left - right)) {
    if (block.type === 'thinking') reasoning += block.content
    else if (block.type === 'text') content += block.content
    else if (block.type === 'tool_use' || block.type.endsWith('_tool_use')) {
      toolCalls.push({
        ...block.id === undefined ? {} : { id: block.id },
        name: block.name ?? 'unknown',
        arguments: block.content,
      })
    }
  }
  if (content === '' && reasoning === '' && toolCalls.length === 0) return undefined
  return { content, ...reasoning === '' ? {} : { reasoning }, ...toolCalls.length === 0 ? {} : { toolCalls } }
}

function responseOf(body: TraceBody | undefined, protocol: TraceConversation['protocol']): ContentResult | undefined {
  if (body?.parsed === undefined) return undefined
  if (body.format === 'sse' && Array.isArray(body.parsed)) return parseStream(body.parsed)
  return parseFinalResponse(body.parsed, protocol)
}

export function buildTraceConversation(
  requestBody: TraceBody | undefined,
  responseBody: TraceBody | undefined,
): TraceConversation | undefined {
  const request = parseRequest(requestBody?.parsed)
  const protocol = request?.protocol ?? 'generic'
  const response = responseOf(responseBody, protocol)
  if (request === undefined && response === undefined) return undefined
  const messages = request?.messages.map(message => ({ ...message })) ?? []
  if (response !== undefined) addMessage(messages, 'response', 'assistant', response, responseBody?.parsed ?? null)
  if (messages.length === 0) return undefined
  return {
    protocol,
    ...request?.model === undefined ? {} : { model: request.model },
    ...request?.stream === undefined ? {} : { stream: request.stream },
    messages: messages.map((message, index) => ({ ...message, index })),
    tools: request?.tools ?? [],
  }
}
