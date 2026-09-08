/** Host-owned persistent terminal registry for the independent Web terminal. */
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
export interface WebServerLike {
  registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void }): () => void
}

export interface HostConnectionLike {
  requestRejection(request: { headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> }): 401 | 403 | undefined
}
import { TERMINAL_PATH, encodeFrame, parseClientFrame, type ClientFrame } from '../core/protocol.ts'
import { TerminalProcess, type PtyFactory, type PtyLike } from '../core/pty.ts'
import { WorkspaceCommandDir } from './workspace-command.ts'

interface TerminalRecord {
  readonly id: string
  readonly cwd: string
  readonly process: TerminalProcess
  sockets: Set<WebSocket>
}

interface SocketBinding {
  readonly record: TerminalRecord
  readonly dispose: () => void
}

/** Minimal node-pty factory loaded lazily so the plugin can report missing optional deps. */
export function loadNodePtyFactory(): PtyFactory {
  const nodePty = createRequire(import.meta.url)('node-pty') as {
    spawn(file: string, args: string[], options: { cwd: string; env: Record<string, string | undefined>; cols: number; rows: number }): PtyLike
  }
  return { spawn: (file, args, options) => nodePty.spawn(file, [...args], options) }
}

export interface TerminalManagerOptions {
  shell?: string
  shellArgs?: readonly string[]
  maxTranscriptBytes?: number
  ptyFactory?: PtyFactory
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly ptyFactory: PtyFactory
  private readonly shell: string
  private readonly shellArgs: readonly string[]
  private readonly maxTranscriptBytes: number
  private readonly workspaceCommands = new WorkspaceCommandDir()
  private readonly server = new WebSocketServer({ noServer: true })

  constructor(options: TerminalManagerOptions = {}) {
    this.ptyFactory = options.ptyFactory ?? loadNodePtyFactory()
    this.shell = options.shell ?? process.env.SHELL ?? '/bin/sh'
    this.shellArgs = options.shellArgs ?? ['-i']
    this.maxTranscriptBytes = options.maxTranscriptBytes ?? 1 << 20
  }

  dispose(): void {
    for (const record of this.terminals.values()) record.process.close()
    this.terminals.clear()
    this.workspaceCommands.dispose()
  }

  register(webServer: WebServerLike, connection: HostConnectionLike): () => Promise<void> {
    const unregister = webServer.registerUpgrade({
      path: TERMINAL_PATH,
      handler: (req, socket, head) => {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          socket.end(`HTTP/1.1 ${String(rejection)} ${rejection === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`)
          return
        }
        this.server.handleUpgrade(req, socket, head, ws => this.accept(ws, req))
      },
    })
    return async () => {
      unregister()
      for (const record of this.terminals.values()) record.process.close()
      for (const ws of this.server.clients) ws.close(1001, 'terminal plugin disposed')
      await new Promise<void>(resolve => this.server.close(() => resolve()))
      this.workspaceCommands.dispose()
      this.terminals.clear()
    }
  }

  private accept(ws: WebSocket, _request: IncomingMessage): void {
    let binding: SocketBinding | undefined
    ws.on('message', raw => {
      const frame = parseClientFrame(raw.toString())
      if (frame === undefined) {
        ws.close(1003, 'invalid terminal frame')
        return
      }
      try {
        this.handleFrame(ws, binding?.record, frame, next => {
          binding = { record: next, dispose: this.bindSocket(ws, next) }
        })
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
        ws.close(1011, 'terminal failure')
      }
    })
    ws.on('close', () => {
      binding?.dispose()
      binding = undefined
    })
  }

  private bindSocket(ws: WebSocket, record: TerminalRecord): () => void {
    record.sockets.add(ws)
    return () => { record.sockets.delete(ws) }
  }

  private handleFrame(
    ws: WebSocket,
    record: TerminalRecord | undefined,
    frame: ClientFrame,
    setRecord: (record: TerminalRecord) => void,
  ): void {
    if (frame.type === 'open') {
      if (record !== undefined) return
      const requestedCwd = frame.cwd ?? globalThis.process.cwd()
      const terminal = this.terminals.get(frame.terminalId) ?? this.create(frame.terminalId, validateCwd(requestedCwd))
      record = terminal
      setRecord(terminal)
      const snapshot = terminal.process.transcript.snapshot()
      if (snapshot.data.length > 0) ws.send(encodeFrame({ type: 'output', data: snapshot.data }))
      ws.send(encodeFrame({ type: 'ready', terminalId: terminal.id, cwd: terminal.cwd }))
      return
    }
    if (record === undefined) {
      ws.close(1008, 'terminal is not open')
      return
    }
    if (frame.type === 'input') record.process.write(frame.data)
    else if (frame.type === 'resize') record.process.resize(frame.cols, frame.rows)
    else if (frame.type === 'close') {
      record.process.close()
      this.terminals.delete(record.id)
      ws.close(1000, 'terminal closed')
    }
  }

  private create(id: string, cwd: string): TerminalRecord {
    const terminalProcess = new TerminalProcess(this.ptyFactory, {
      shell: this.shell,
      shellArgs: this.shellArgs,
      cwd,
      maxTranscriptBytes: this.maxTranscriptBytes,
      env: { ...globalThis.process.env, PATH: this.workspaceCommands.prepend(globalThis.process.env.PATH) },
    })
    const record: TerminalRecord = { id, cwd, process: terminalProcess, sockets: new Set() }
    terminalProcess.onData(data => {
      for (const client of record.sockets) {
        if (client.readyState === WebSocket.OPEN) client.send(encodeFrame({ type: 'output', data }))
      }
    })
    terminalProcess.onExit(event => {
      for (const client of record.sockets) {
        if (client.readyState === WebSocket.OPEN) client.send(encodeFrame({ type: 'exit', code: event.exitCode, ...(event.signal === undefined ? {} : { signal: String(event.signal) }) }))
      }
    })
    this.terminals.set(id, record)
    return record
  }
}

function validateCwd(value: string): string {
  try {
    const stats = statSync(value)
    if (!stats.isDirectory()) throw new Error('terminal cwd is not a directory')
    return value
  } catch (error) {
    if (error instanceof Error && error.message === 'terminal cwd is not a directory') throw error
    throw new Error(`terminal cwd is unavailable: ${value}`)
  }
}
