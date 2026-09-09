import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { DelegationRuntime, type SubprocessRuntimeLike } from '../src/delegation/runtime.ts'
import { DelegateTaskStore } from '../src/delegation/store.ts'

class FakeProcess {
  readonly pid = 123
  readonly stdin = undefined
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  private resolveDone!: (value: { exitCode: number | null; signal: string | null }) => void
  readonly done = new Promise<{ exitCode: number | null; signal: string | null }>(resolve => { this.resolveDone = resolve })
  terminateCalls = 0

  terminate(): void {
    this.terminateCalls += 1
    this.stdout.end()
    this.stderr.end()
    this.resolveDone({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(): Promise<boolean> { return Promise.resolve(true) }

  complete(stdout: string, stderr = '', exitCode = 0): void {
    this.stdout.end(stdout)
    this.stderr.end(stderr)
    this.resolveDone({ exitCode, signal: null })
  }
}

class FakeSubprocess implements SubprocessRuntimeLike {
  readonly processes: FakeProcess[] = []
  async resolveExecutable(command: string): Promise<string> { return `/fake/${command}` }
  spawn(): FakeProcess {
    const process = new FakeProcess()
    this.processes.push(process)
    return process
  }
}

async function fixture(timeoutMs = 1000): Promise<{
  directory: string
  runtime: DelegationRuntime
  store: DelegateTaskStore
  subprocess: FakeSubprocess
}> {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-runtime-'))
  const config = resolveConfig({ dataDir: directory, defaultTimeoutMs: timeoutMs, terminateGraceMs: 10 })
  const store = new DelegateTaskStore(directory, 30)
  await store.initialize()
  const subprocess = new FakeSubprocess()
  return { directory, store, subprocess, runtime: new DelegationRuntime(subprocess, store, config, error => { throw error }) }
}

async function waitForTerminal(runtime: DelegationRuntime, id: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    const status = runtime.get(id, 'session')?.status
    if (status !== 'starting' && status !== 'running' && status !== 'stopping') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('task did not settle')
}

const request = {
  ownerSessionId: 'session', workspaceId: 'workspace', adapterId: 'pi' as const,
  prompt: 'test', cwd: process.cwd(), permissionMode: 'read-only' as const,
}

test('runtime streams structured output and commits a successful result', async () => {
  const f = await fixture()
  try {
    const started = await f.runtime.start(request)
    f.subprocess.processes[0]?.complete(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } })}\n`)
    await waitForTerminal(f.runtime, started.id)
    const settled = f.runtime.get(started.id, 'session')
    assert.equal(settled?.status, 'completed')
    assert.equal(settled?.finalText, 'done')
    assert.equal(settled?.exitCode, 0)
  } finally {
    await f.runtime.dispose()
    await f.store.close()
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('runtime cancellation terminates the process tree and records killed', async () => {
  const f = await fixture()
  try {
    const started = await f.runtime.start(request)
    assert.equal(await f.runtime.cancel(started.id, 'session'), 'requested')
    await waitForTerminal(f.runtime, started.id)
    assert.equal(f.subprocess.processes[0]?.terminateCalls, 1)
    assert.equal(f.runtime.get(started.id, 'session')?.status, 'killed')
  } finally {
    await f.runtime.dispose()
    await f.store.close()
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('runtime timeout terminates and classifies independently from cancellation', async () => {
  const f = await fixture(15)
  try {
    const started = await f.runtime.start(request)
    await waitForTerminal(f.runtime, started.id)
    assert.equal(f.runtime.get(started.id, 'session')?.status, 'timed-out')
    assert.equal(f.runtime.get(started.id, 'session')?.timedOut, true)
  } finally {
    await f.runtime.dispose()
    await f.store.close()
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('runtime does not expose another session task', async () => {
  const f = await fixture()
  try {
    const started = await f.runtime.start(request)
    assert.equal(f.runtime.get(started.id, 'other'), undefined)
    f.subprocess.processes[0]?.complete('')
    await waitForTerminal(f.runtime, started.id)
  } finally {
    await f.runtime.dispose()
    await f.store.close()
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('runtime reserves concurrency while an asynchronous start is resolving', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-runtime-'))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const firstResolution = new Promise<void>(resolve => { entered = resolve })
  class DelayedSubprocess extends FakeSubprocess {
    override async resolveExecutable(command: string): Promise<string> {
      entered()
      await gate
      return super.resolveExecutable(command)
    }
  }
  const config = resolveConfig({ dataDir: directory, maxConcurrentRuns: 1, terminateGraceMs: 10 })
  const store = new DelegateTaskStore(directory, 30)
  await store.initialize()
  const subprocess = new DelayedSubprocess()
  const runtime = new DelegationRuntime(subprocess, store, config, error => { throw error })
  try {
    const first = runtime.start(request)
    await firstResolution
    const second = runtime.start({ ...request, prompt: 'second' })
    release()
    await assert.rejects(second, /concurrency limit/u)
    const started = await first
    subprocess.processes[0]?.complete('')
    await waitForTerminal(runtime, started.id)
  } finally {
    release()
    await runtime.dispose()
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
