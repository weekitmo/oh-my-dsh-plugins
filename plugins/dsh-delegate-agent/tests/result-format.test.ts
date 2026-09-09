import assert from 'node:assert/strict'
import test from 'node:test'
import { outputLines, parseOutputLines, resultFormat } from '../src/client/result-format.ts'

test('result format recognizes complete JSON values', () => {
  assert.equal(resultFormat('{"ok":true}'), 'json')
  assert.equal(resultFormat('[1, 2, 3]'), 'json')
  assert.equal(resultFormat('```json\n{"ok":true}\n```'), 'markdown')
})

test('result format treats prose and empty content as markdown', () => {
  assert.equal(resultFormat('# Result\n\nDone.'), 'markdown')
  assert.equal(resultFormat(''), 'markdown')
})

test('standard output lines normalize newlines without adding a trailing row', () => {
  assert.deepEqual(outputLines('first\r\nsecond\n'), ['first', 'second'])
  assert.deepEqual(outputLines(''), [])
})

test('structured output lines parse JSONL and derive compact event labels', () => {
  const lines = parseOutputLines('{"type":"session","id":"one"}\n{"update":{"sessionUpdate":"tool_call"}}\nplain')
  assert.equal(lines[0]?.summary, 'session')
  assert.equal(lines[1]?.summary, 'tool_call')
  assert.equal(lines[2]?.summary, 'line 3')
  assert.deepEqual(lines[0]?.parsed, { type: 'session', id: 'one' })
  assert.equal(lines[2]?.parsed, undefined)
})
