import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTraceConversation } from '../src/client/conversation-data.ts'
import type { JsonValue, TraceBody } from '../src/trace/types.ts'

function body(parsed: JsonValue, format: TraceBody['format'] = 'json'): TraceBody {
  return { raw: JSON.stringify(parsed), format, bytes: 1, truncated: false, parsed }
}

test('reconstructs OpenAI chat request messages and streamed assistant tool calls', () => {
  const conversation = buildTraceConversation(body({
    model: 'deepseek-chat',
    stream: true,
    messages: [
      { role: 'system', content: 'Be exact.' },
      { role: 'user', content: [{ type: 'text', text: 'Weather?' }, { type: 'image_url', image_url: { url: 'https://example/image.png' } }] },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'weather', arguments: '{"city":"Shenzhen"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: '{"temperature":28}' },
    ],
    tools: [{ type: 'function', function: { name: 'weather', description: 'Read weather', parameters: { type: 'object' } } }],
  }), body([
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'Need summarize. ' } }] },
    { choices: [{ delta: { content: 'It is ' } }] },
    { choices: [{ delta: { content: '28 C.', tool_calls: [{ index: 0, id: 'call-2', function: { name: 'notify', arguments: '{"ok":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'true}' } }] } }] },
  ], 'sse'))

  assert.equal(conversation?.protocol, 'openai-chat')
  assert.equal(conversation?.model, 'deepseek-chat')
  assert.equal(conversation?.stream, true)
  assert.deepEqual(conversation?.messages.map(message => [message.phase, message.role, message.content]), [
    ['request', 'system', 'Be exact.'],
    ['request', 'user', 'Weather?'],
    ['request', 'assistant', ''],
    ['request', 'tool', '{"temperature":28}'],
    ['response', 'assistant', 'It is 28 C.'],
  ])
  assert.equal(conversation?.messages[1]?.attachments?.[0]?.kind, 'image')
  assert.equal(conversation?.messages[4]?.reasoning, 'Need summarize. ')
  assert.deepEqual(conversation?.messages[4]?.toolCalls, [{
    id: 'call-2', name: 'notify', arguments: '{"ok":true}',
  }])
  assert.equal(conversation?.tools[0]?.name, 'weather')
})

test('reconstructs OpenAI Responses input and completed response output', () => {
  const conversation = buildTraceConversation(body({
    model: 'gpt-responses',
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: 'Use tools.' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Read file.' }] },
      { type: 'function_call', call_id: 'read-1', name: 'read_file', arguments: '{"path":"a"}' },
      { type: 'function_call_output', call_id: 'read-1', output: 'contents' },
    ],
  }), body({
    output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Reviewed.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
      { type: 'function_call', call_id: 'write-1', name: 'write_file', arguments: '{"path":"b"}' },
    ],
  }))

  assert.equal(conversation?.protocol, 'openai-responses')
  assert.deepEqual(conversation?.messages.map(message => message.role), ['developer', 'user', 'assistant', 'tool', 'assistant'])
  assert.equal(conversation?.messages.at(-1)?.content, 'Done.')
  assert.equal(conversation?.messages.at(-1)?.reasoning, 'Reviewed.')
  assert.equal(conversation?.messages.at(-1)?.toolCalls?.[0]?.name, 'write_file')
})

test('aggregates OpenAI Responses API streaming deltas', () => {
  const conversation = buildTraceConversation(body({ input: 'Question', stream: true }), body([
    { type: 'response.reasoning_summary_text.delta', delta: 'Think. ' },
    { type: 'response.output_text.delta', delta: 'Answer' },
    { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'lookup', arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"id":1}' },
  ], 'sse'))

  assert.equal(conversation?.messages.at(-1)?.content, 'Answer')
  assert.equal(conversation?.messages.at(-1)?.reasoning, 'Think. ')
  assert.deepEqual(conversation?.messages.at(-1)?.toolCalls, [{ id: 'call-1', name: 'lookup', arguments: '{"id":1}' }])
})

test('normalizes Anthropic system, tool result, thinking, and streamed tool use', () => {
  const conversation = buildTraceConversation(body({
    model: 'claude',
    system: [{ type: 'text', text: 'System prompt' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Run it' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'Need tool' }, { type: 'tool_use', id: 'tool-1', name: 'run', input: { cmd: 'pwd' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp' }] },
    ],
    tools: [{ name: 'run', description: 'Run command', input_schema: { type: 'object' } }],
  }), body([
    { type: 'message_start', message: { role: 'assistant' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check result. ' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Located.' } },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool-2', name: 'read' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":"x"}' } },
  ], 'sse'))

  assert.equal(conversation?.protocol, 'anthropic')
  assert.deepEqual(conversation?.messages.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'assistant'])
  assert.equal(conversation?.messages[2]?.reasoning, 'Need tool')
  assert.equal(conversation?.messages[3]?.toolCallId, 'tool-1')
  assert.equal(conversation?.messages.at(-1)?.content, 'Located.')
  assert.equal(conversation?.messages.at(-1)?.reasoning, 'Check result. ')
  assert.equal(conversation?.messages.at(-1)?.toolCalls?.[0]?.name, 'read')
})

test('uses a completed streamed response instead of duplicating earlier deltas', () => {
  const conversation = buildTraceConversation(body({ input: 'Question' }), body([
    { type: 'response.output_text.delta', delta: 'Partial' },
    { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Complete' }] }] } },
  ], 'sse'))
  assert.equal(conversation?.messages.at(-1)?.content, 'Complete')
})

test('returns undefined for bodies with no recognizable conversation data', () => {
  assert.equal(buildTraceConversation(body({ prompt: 123 }), body({ usage: { input_tokens: 2 } })), undefined)
})
