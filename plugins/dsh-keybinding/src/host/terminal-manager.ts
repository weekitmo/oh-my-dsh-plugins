/** Host-owned persistent terminal registry for the independent Web terminal. */
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
export interface WebServerLike {
  register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void }): () => void
}

export interface TerminalWebFontOptions {
  family: string
  path: string
}

export interface HostConnectionLike {
  requestRejection(request: { headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> }): 401 | 403 | undefined
}
import { TERMINAL_FONT_CSS_PATH, TERMINAL_FONT_FILE_PATH, TERMINAL_PATH, encodeFrame, parseClientFrame, type ClientFrame } from '../core/protocol.ts'
import { TerminalProcess, type PtyFactory, type PtyLike } from '../core/pty.ts'
import { TerminalFontCatalog, type TerminalFontCatalogLike } from './terminal-font-catalog.ts'
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
  webFont?: TerminalWebFontOptions
  discoverSystemFonts?: boolean
  fontDirectories?: readonly string[]
  fontCatalog?: TerminalFontCatalogLike
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly ptyFactory: PtyFactory
  private readonly shell: string
  private readonly shellArgs: readonly string[]
  private readonly maxTranscriptBytes: number
  private readonly workspaceCommands = new WorkspaceCommandDir()
  private readonly fontCatalog: TerminalFontCatalogLike
  private readonly server = new WebSocketServer({ noServer: true })

  constructor(options: TerminalManagerOptions = {}) {
    this.ptyFactory = options.ptyFactory ?? loadNodePtyFactory()
    this.shell = options.shell ?? process.env.SHELL ?? '/bin/sh'
    this.shellArgs = options.shellArgs ?? ['-i']
    this.maxTranscriptBytes = options.maxTranscriptBytes ?? 1 << 20
    const configured = normalizeWebFont(options.webFont)
    this.fontCatalog = options.fontCatalog ?? new TerminalFontCatalog({
      ...(configured === undefined ? {} : { configured }),
      ...(options.discoverSystemFonts === undefined ? {} : { discoverSystemFonts: options.discoverSystemFonts }),
      ...(options.fontDirectories === undefined ? {} : { directories: options.fontDirectories }),
    })
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
    const unregisterFontCss = webServer.register({
      kind: 'exact',
      path: TERMINAL_FONT_CSS_PATH,
      handler: (req, res) => serveFontStylesheet(req, res, this.fontCatalog, connection),
    })
    const unregisterFontFile = webServer.register({
      kind: 'exact',
      path: TERMINAL_FONT_FILE_PATH,
      handler: (req, res) => serveFontFile(req, res, this.fontCatalog, connection),
    })
    return async () => {
      unregisterFontFile()
      unregisterFontCss()
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

function normalizeWebFont(value: TerminalWebFontOptions | undefined): TerminalWebFontOptions | undefined {
  if (value === undefined) return undefined
  const family = value.family.trim()
  const path = value.path.trim()
  return family.length === 0 || path.length === 0 ? undefined : { family, path }
}

function rejectHttpRequest(req: IncomingMessage, res: ServerResponse, connection: HostConnectionLike): boolean {
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'Unauthorized' : 'Forbidden')
  return true
}

async function serveFontStylesheet(
  req: IncomingMessage,
  res: ServerResponse,
  fonts: TerminalFontCatalogLike,
  connection: HostConnectionLike,
): Promise<void> {
  if (rejectHttpRequest(req, res, connection)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const css = (await fonts.list()).flatMap(font => {
    const format = fontFormat(font.path)
    const source = `${TERMINAL_FONT_FILE_PATH}?id=${font.id}`
    return [400, 700].map(weight => `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(source)}) format(${JSON.stringify(format)});font-style:normal;font-weight:${String(weight)};font-display:block;}`)
  }).join('')
  res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : css)
}

async function serveFontFile(
  req: IncomingMessage,
  res: ServerResponse,
  fonts: TerminalFontCatalogLike,
  connection: HostConnectionLike,
): Promise<void> {
  if (rejectHttpRequest(req, res, connection)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const id = new URL(req.url ?? TERMINAL_FONT_FILE_PATH, 'http://localhost').searchParams.get('id')
  const font = id === null ? (await fonts.list())[0] : await fonts.get(id)
  if (font === undefined) {
    res.writeHead(404)
    res.end('font unavailable')
    return
  }
  try {
    const body = await readFile(font.path)
    res.writeHead(200, {
      'content-type': fontContentType(font.path),
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(404)
    res.end('font file unavailable')
  }
}

function fontFormat(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.woff2': return 'woff2'
    case '.woff': return 'woff'
    case '.otf': return 'opentype'
    case '.ttc':
    case '.otc': return 'collection'
    default: return 'truetype'
  }
}

function fontContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.woff2': return 'font/woff2'
    case '.woff': return 'font/woff'
    case '.otf': return 'font/otf'
    case '.ttc':
    case '.otc': return 'font/collection'
    default: return 'font/ttf'
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
