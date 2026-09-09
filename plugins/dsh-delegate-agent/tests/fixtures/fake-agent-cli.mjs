#!/usr/bin/env node
import { basename } from 'node:path'

const command = basename(process.argv[1] ?? '')
const args = process.argv.slice(2)
const prompt = args.at(-1) ?? ''

if (prompt.includes('hold-for-cancel')) {
  process.on('SIGTERM', () => process.exit(143))
  setInterval(() => {}, 1000)
} else if (command === 'pi') {
  const finalText = prompt.includes('json-result')
    ? JSON.stringify({ status: 'ok', source: 'fake-pi', items: [1, 2, 3] }, null, 2)
    : prompt.includes('markdown-result')
      ? '# Fake result\n\n- **status**: complete\n- `source`: fake-pi'
      : 'fake pi completed'
  process.stdout.write(`${JSON.stringify({ type: 'session', id: 'fake-pi-session' })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'tool_execution_start', toolName: 'fake-read' })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'INTERNAL_INTERMEDIATE_SHOULD_NOT_APPEAR' }] } })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: finalText }] } })}\n`)
} else if (command === 'codex') {
  process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: 'fake-codex-thread' })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'fake codex completed' } })}\n`)
  process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } })}\n`)
} else if (command === 'grok') {
  process.stdout.write(`${JSON.stringify({ session_id: 'fake-grok-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fake grok completed' } } })}\n`)
} else {
  process.stderr.write(`unknown fake adapter: ${command}\n`)
  process.exitCode = 2
}
