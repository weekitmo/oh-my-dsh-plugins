import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInvocation, commandPreview } from '../src/delegation/adapters.ts'

test('builds a safe Pi JSON invocation', () => {
  const invocation = buildInvocation({
    adapterId: 'pi', executable: '/bin/pi', prompt: '- review this', cwd: '/workspace',
    provider: 'openai-codex', model: 'gpt-5', reasoning: 'high', permissionMode: 'read-only',
  })
  assert.deepEqual(invocation.argv, [
    '/bin/pi', '--mode', 'json', '--print', '--no-session', '--no-approve',
    '--provider', 'openai-codex', '--model', 'gpt-5', '--thinking', 'high',
    '--tools', 'read,grep,find,ls', '--', '- review this',
  ])
  assert.equal(commandPreview(invocation.argv).at(-1), '<prompt>')
})

test('builds Codex exec with options before the prompt', () => {
  assert.deepEqual(buildInvocation({
    adapterId: 'codex', executable: 'codex', prompt: 'fix it', cwd: '/workspace',
    model: 'gpt-5.3-codex', permissionMode: 'workspace-write',
  }).argv, [
    'codex', 'exec', '--json', '--color', 'never', '-C', '/workspace',
    '--sandbox', 'workspace-write', '--ephemeral', '--model', 'gpt-5.3-codex', 'fix it',
  ])
})

test('builds Grok single mode with the prompt attached to -p', () => {
  assert.deepEqual(buildInvocation({
    adapterId: 'grok', executable: 'grok', prompt: 'research it', cwd: '/workspace',
    reasoning: 'high', permissionMode: 'read-only',
  }).argv, [
    'grok', '--output-format', 'streaming-json', '--cwd', '/workspace',
    '--permission-mode', 'plan', '--reasoning-effort', 'high', '-p', 'research it',
  ])
})

test('rejects unsupported adapter overrides', () => {
  assert.throws(() => buildInvocation({
    adapterId: 'codex', executable: 'codex', prompt: 'x', cwd: '/workspace',
    provider: 'openai', permissionMode: 'read-only',
  }), /does not support a provider override/u)
})
