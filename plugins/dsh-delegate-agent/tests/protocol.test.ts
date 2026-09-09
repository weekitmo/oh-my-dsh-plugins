import assert from 'node:assert/strict'
import test from 'node:test'
import { ProtocolParser } from '../src/delegation/protocol.ts'

test('Pi parser handles split UTF-8 JSONL and extracts final text and session', () => {
  const parser = new ProtocolParser('pi', 20)
  const line = Buffer.from(`${JSON.stringify({ type: 'session', id: 'pi-session' })}\n${JSON.stringify({
    type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] },
  })}\n`)
  parser.push(line.subarray(0, line.length - 2))
  parser.push(line.subarray(line.length - 2))
  const result = parser.finish()
  assert.equal(result.externalSessionId, 'pi-session')
  assert.equal(result.finalText, '完成')
  assert.equal(result.diagnostics.length, 0)
})

test('Codex parser reads thread, final agent message, and usage', () => {
  const parser = new ProtocolParser('codex', 20)
  parser.push(`${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n`)
  parser.push(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } })}\n`)
  parser.push(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 3 } })}\n`)
  const result = parser.finish()
  assert.equal(result.externalSessionId, 'thread-1')
  assert.equal(result.finalText, 'done')
  assert.equal(result.events.some(event => event.type === 'usage'), true)
})

test('Grok parser accumulates ACP message chunks', () => {
  const parser = new ProtocolParser('grok', 20)
  parser.push(`${JSON.stringify({ session_id: 'grok-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } } })}\n`)
  parser.push(`${JSON.stringify({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } } })}\n`)
  assert.equal(parser.finish().finalText, 'hello world')
})

test('malformed lines become bounded diagnostics', () => {
  const parser = new ProtocolParser('pi', 2)
  parser.push('not-json\nnot-json-either\nthird\n')
  const result = parser.finish()
  assert.equal(result.events.length, 2)
  assert.equal(result.diagnostics.length, 3)
})
