import { createServer, type IncomingMessage } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalManager, type HostConnectionLike, type WebServerLike } from '../src/host/terminal-manager.ts'
import type { PtyFactory, PtyLike } from '../src/core/pty.ts'

type DataListener = (data: string) => void
type ExitListener = (event: { exitCode: number; signal?: number }) => void

class FakePty implements PtyLike {
  readonly pid = 1001
  readonly process = 'fake-shell'
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  private dataListener: DataListener | undefined
  private exitListener: ExitListener | undefined
  private ioWaiter: (() => void) | undefined

  onData(listener: DataListener) { this.dataListener = listener; return { dispose: () => { this.dataListener = undefined } } }
  onExit(listener: ExitListener) { this.exitListener = listener; return { dispose: () => { this.exitListener = undefined } } }
  write(data: string) { this.writes.push(data); this.resolveIo() }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]); this.resolveIo() }
  waitForIo() {
    if (this.writes.length > 0 && this.resizes.length > 0) return Promise.resolve()
    return new Promise<void>(resolve => { this.ioWaiter = resolve })
  }
  private resolveIo() {
    if (this.writes.length === 0 || this.resizes.length === 0) return
    this.ioWaiter?.()
    this.ioWaiter = undefined
  }
  kill() { this.exitListener?.({ exitCode: 0 }) }
  emit(data: string) { this.dataListener?.(data) }
}

class FakeFactory implements PtyFactory {
  readonly spawned: FakePty[] = []
  spawn(_file: string, _args: readonly string[], _options: { cwd: string; env: Record<string, string | undefined>; cols: number; rows: number }) {
    const pty = new FakePty()
    this.spawned.push(pty)
    return pty
  }
}

function messageQueue(socket: WebSocket): { next(): Promise<Record<string, unknown>> } {
  const messages: Record<string, unknown>[] = []
  const waiters: Array<(message: Record<string, unknown>) => void> = []
  socket.on('message', value => {
    const message = JSON.parse(value.toString()) as Record<string, unknown>
    const waiter = waiters.shift()
    if (waiter === undefined) messages.push(message)
    else waiter(message)
  })
  return {
    next: () => new Promise(resolve => {
      const message = messages.shift()
      if (message === undefined) waiters.push(resolve)
      else resolve(message)
    }),
  }
}

async function openSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/dsh-terminal/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

describe('TerminalManager', () => {
  let server: ReturnType<typeof createServer> | undefined
  let unregister: (() => Promise<void>) | undefined
  let manager: TerminalManager | undefined
  let cwd: string | undefined

  afterEach(async () => {
    await unregister?.()
    manager?.dispose()
    await new Promise<void>(resolve => server?.close(() => resolve()))
    if (cwd !== undefined) rmSync(cwd, { recursive: true, force: true })
    server = undefined
    unregister = undefined
    manager = undefined
    cwd = undefined
  })

  it('authenticates before upgrade and replays one persistent terminal transcript', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'dsh-keybinding-test-'))
    const factory = new FakeFactory()
    manager = new TerminalManager({ ptyFactory: factory, maxTranscriptBytes: 1024 })
    server = createServer()
    const webServer: WebServerLike = {
      registerUpgrade(route) {
        server?.on('upgrade', (request, socket, head) => {
          if (request.url?.split('?')[0] === route.path) route.handler(request, socket, head)
        })
        return () => {}
      },
    }
    let rejectionCalls = 0
    const connection: HostConnectionLike = {
      requestRejection(_request: { headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> }) {
        rejectionCalls += 1
        return undefined
      },
    }
    unregister = manager.register(webServer, connection)
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()))
    const address = server?.address()
    if (address === null || typeof address === 'string' || address === undefined) throw new Error('server did not bind')

    const first = await openSocket(address.port)
    const firstMessages = messageQueue(first)
    first.send(JSON.stringify({ type: 'open', terminalId: 'test-terminal', cwd }))
    await expect(firstMessages.next()).resolves.toMatchObject({ type: 'ready', terminalId: 'test-terminal', cwd })
    expect(rejectionCalls).toBe(1)
    expect(factory.spawned).toHaveLength(1)

    first.send(JSON.stringify({ type: 'input', data: 'echo ok\r' }))
    first.send(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }))
    await factory.spawned[0]?.waitForIo()
    expect(factory.spawned[0]?.writes).toEqual(['echo ok\r'])
    expect(factory.spawned[0]?.resizes).toEqual([[100, 40]])

    factory.spawned[0]?.emit('visible output')
    await expect(firstMessages.next()).resolves.toEqual({ type: 'output', data: 'visible output' })
    const firstClosed = new Promise<void>(resolve => first.once('close', () => resolve()))
    first.close()
    await firstClosed

    const second = await openSocket(address.port)
    const secondMessages = messageQueue(second)
    second.send(JSON.stringify({ type: 'open', terminalId: 'test-terminal', cwd: join(cwd, 'missing') }))
    await expect(secondMessages.next()).resolves.toEqual({ type: 'output', data: 'visible output' })
    await expect(secondMessages.next()).resolves.toMatchObject({ type: 'ready', cwd })
    expect(factory.spawned).toHaveLength(1)
    second.close()
  })

  it('rejects an unavailable cwd without spawning a process', async () => {
    const factory = new FakeFactory()
    manager = new TerminalManager({ ptyFactory: factory })
    server = createServer()
    const webServer: WebServerLike = {
      registerUpgrade(route) {
        server?.on('upgrade', (request, socket, head) => {
          if (request.url?.split('?')[0] === route.path) route.handler(request, socket, head)
        })
        return () => {}
      },
    }
    unregister = manager.register(webServer, { requestRejection: () => undefined })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()))
    const address = server?.address()
    if (address === null || typeof address === 'string' || address === undefined) throw new Error('server did not bind')
    const socket = await openSocket(address.port)
    const messages = messageQueue(socket)
    socket.send(JSON.stringify({ type: 'open', terminalId: 'invalid-cwd', cwd: join(tmpdir(), 'dsh-no-such-directory') }))
    await expect(messages.next()).resolves.toMatchObject({ type: 'error', message: expect.stringContaining('terminal cwd is unavailable') })
    expect(factory.spawned).toHaveLength(0)
    socket.close()
  })
})
