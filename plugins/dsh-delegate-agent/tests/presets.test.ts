import assert from 'node:assert/strict'
import test from 'node:test'
import { composePrompt } from '../src/delegation/presets.ts'

test('composePrompt replaces the first task marker', () => {
  assert.equal(composePrompt('Review this:\n{{task}}\nDo not edit. {{task}}', 'src/index.ts'), 'Review this:\nsrc/index.ts\nDo not edit. {{task}}')
})

test('composePrompt preserves replacement-pattern characters in task instructions', () => {
  const task = "printf '%s' \"$&\" \"$`\" \"$'\""
  assert.equal(composePrompt('Run exactly:\n{{task}}', task), `Run exactly:\n${task}`)
})

test('composePrompt appends task instructions when no marker exists', () => {
  assert.equal(composePrompt('Act as a reviewer.', 'Review the RPC.'), 'Act as a reviewer.\n\nTask:\nReview the RPC.')
})

test('composePrompt rejects an empty task instruction', () => {
  assert.throws(() => composePrompt('Act as a reviewer.', '  '), /must not be empty/u)
})
