/** Small PTY seam: the rest of the plugin does not know node-pty details. */

import { Transcript, WorkspaceFrameFilter } from './transcript.ts'

export interface PtyLike {
  readonly pid: number
  readonly process: string
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface PtyFactory {
  spawn(file: string, args: readonly string[], options: {
    cwd: string
    env: Record<string, string | undefined>
    cols: number
    rows: number
  }): PtyLike
}

export interface TerminalProcessOptions {
  shell: string
  shellArgs: readonly string[]
  cwd: string
  cols?: number
  rows?: number
  maxTranscriptBytes?: number
  env?: Record<string, string | undefined>
}

export class TerminalProcess {
  readonly transcript
  readonly pty: PtyLike
  private readonly filter = new WorkspaceFrameFilter()
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(factory: PtyFactory, options: TerminalProcessOptions) {
    const env = { ...options.env, DSH_TERMINAL_PLUGIN: '1' }
    this.transcript = new Transcript(options.maxTranscriptBytes)
    this.pty = factory.spawn(options.shell, options.shellArgs, {
      cwd: options.cwd,
      env,
      cols: options.cols ?? 120,
      rows: options.rows ?? 32,
    })
    this.pty.onData(data => {
      const filtered = this.filter.consume(data)
      this.transcript.appendVisible(filtered.visible)
      for (const listener of this.dataListeners) listener(data)
    })
    this.pty.onExit(event => {
      for (const listener of this.exitListeners) listener(event)
    })
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => { this.dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void {
    this.exitListeners.add(listener)
    return () => { this.exitListeners.delete(listener) }
  }

  write(data: string): void { this.pty.write(data) }
  resize(cols: number, rows: number): void { this.pty.resize(cols, rows) }
  close(): void { this.pty.kill() }
}
