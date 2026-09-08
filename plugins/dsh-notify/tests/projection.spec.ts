import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { applyProjectionEvent, boundText, EMPTY_PROJECTION, notifyProjection, type NotifyProjectionState } from '../src/projection.ts'

function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as SessionEvent
}

function fold(events: readonly SessionEvent[], maxBodyChars = 400) {
  let state: NotifyProjectionState = { openTurn: null, last: null }
  for (const item of events) state = applyProjectionEvent(state, item, maxBodyChars)
  return notifyProjection({ maxBodyChars }).view(state)
}

function toolCall(name: string, argumentsValue: unknown, turn = 1, callId = 'call-test'): SessionEvent {
  return event('tool/call', {
    turn,
    step: 1,
    callId,
    name,
    arguments: typeof argumentsValue === 'string' ? argumentsValue : JSON.stringify(argumentsValue),
  })
}

function toolResult(text: string, turn = 1, callId = 'call-test'): SessionEvent {
  return event('tool/result', {
    turn,
    step: 1,
    message: {
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text }],
        isError: false,
      }],
    },
  })
}

describe('notification projection', () => {
  it('reports an empty view before the first completed turn', () => {
    expect(fold([])).toEqual(EMPTY_PROJECTION)
  })

  it('captures text and the exact end reason', () => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      event('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'failed' }] } }),
      event('turn/end', { turn: 1, reason: { kind: 'error' } }),
    ])).toEqual({ turn: 1, reason: 'error', body: 'failed', startedAsyncDelegation: false })
  })

  it('bounds projected reply text without splitting Unicode code points', () => {
    expect(boundText('123456', 4)).toBe('123…')
    expect(boundText('A😀BC', 3)).toBe('A😀…')
    const definition = notifyProjection({ maxBodyChars: 4 })
    expect(definition.key).toBe('dshNotify')
    expect(definition.stateVersion).toBe(2)
  })

  it.each([
    ['de_coi_dispatch', {}, true],
    ['subagent', {}, true],
    ['subagent', { run_in_background: true }, true],
    ['subagent', { run_in_background: false }, false],
    ['subagent_fork', {}, true],
    ['subagent_fork', { run_in_background: false }, false],
    ['bash', { command: 'sleep 1', run_in_background: true }, true],
    ['bash', { command: 'echo done' }, false],
    ['de_session', { action: 'spawn' }, true],
    ['de_session', { action: 'status' }, false],
    ['run_workflow', { workflow: 'release' }, true],
    ['run_workflow', { workflow: 'release', wait: false }, true],
    ['run_workflow', { workflow: 'release', wait: true }, false],
    ['create_goal', { title: 'ship' }, true],
    ['update_goal', { action: 'resume' }, true],
    ['update_goal', { action: 'edit' }, true],
    ['update_goal', { action: 'complete' }, false],
  ] as const)('projects whether %s starts async delegation for %j', (name, args, expected) => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall(name, args),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ turn: 1, startedAsyncDelegation: expected })
  })

  it.each([
    'await tools.bash({ command: "sleep 1", run_in_background: true })',
    'tools.subagent({ task: "inspect", run_in_background: true })',
    'tools.subagent_fork({ session_id: "child", run_in_background: true })',
    'const prompt = `fix ${JSON.stringify({ nested: true })}`; await tools.bash({ command: `codex ${prompt}`, run_in_background: true })',
  ])('conservatively recognizes known background calls inside functions.run_code', code => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall('functions.run_code', { code }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ startedAsyncDelegation: true })
  })

  it.each([
    'await tools.bash({ command: "echo done" })',
    'tools.subagent({ task: "inspect", run_in_background: false })',
    'const tool = "tools.bash"; const background = "run_in_background:true"',
  ])('does not infer run_code background work without one known literal call', code => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall('functions.run_code', { code }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ startedAsyncDelegation: false })
  })

  it('allows a final summary when async work settles and is collected in the same turn', () => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall('de_coi_dispatch', {}, 1, 'launch'),
      toolCall('de_coi_wait', { taskId: 'coi-1' }, 1, 'collect'),
      toolResult('任务 coi-1：completed', 1, 'collect'),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ turn: 1, startedAsyncDelegation: false })
  })

  it('keeps suppression until every same-turn async launch is collected', () => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall('de_coi_dispatch', {}, 1, 'launch-1'),
      toolCall('de_coi_dispatch', {}, 1, 'launch-2'),
      toolCall('de_coi_wait', { taskId: 'coi-1' }, 1, 'collect'),
      toolResult('任务 coi-1：completed', 1, 'collect'),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ turn: 1, startedAsyncDelegation: true })
  })

  it('keeps suppression when a collector reports work still running', () => {
    expect(fold([
      event('turn/start', { turn: 1 }),
      toolCall('bash', { command: 'work', run_in_background: true }, 1, 'launch'),
      toolCall('job_output', { job_id: 'bash-1', wait: true }, 1, 'collect'),
      toolResult('[status: running]', 1, 'collect'),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toMatchObject({ turn: 1, startedAsyncDelegation: true })
  })

  it('keeps a turn marked after any one async dispatch and ignores calls from another turn', () => {
    expect(fold([
      event('turn/start', { turn: 2 }),
      toolCall('bash', { run_in_background: true }, 1),
      toolCall('de_coi_dispatch', {}, 2),
      toolCall('bash', { run_in_background: false }, 2),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])).toMatchObject({ turn: 2, startedAsyncDelegation: true })
  })
})
