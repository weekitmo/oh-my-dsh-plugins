/** Embedded xterm surface mounted in DSH's conversation input dock. */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_PATH, type ServerFrame, type WorkspaceAction } from '../core/protocol.ts'
import { WorkspaceFrameFilter } from '../core/transcript.ts'
import type { ISessions, IWorkspaces, LayoutClient, SessionClient } from './types.ts'
import { currentWorkspacePath } from './terminal-cwd.ts'
import { loadTerminalFont, resolveTerminalFont } from './terminal-font.ts'
import type { TerminalUiStore } from './terminal-store.ts'
import { runWorkspaceAction } from './workspace-action.ts'

export interface TerminalClientContext {
  workspaces: IWorkspaces
  uiWorkspace: SessionClient
  sessions: ISessions
  layout?: LayoutClient
}

interface TerminalPanelProps {
  context: TerminalClientContext
  store: TerminalUiStore
}

/**
 * Render the active terminal as an in-flow, resizable conversation dock.
 * @param props - Host service adapters and shared terminal UI state.
 * @returns The dock, or `null` while closed.
 */
export function TerminalPanel({ context, store }: TerminalPanelProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const fitRef = useRef<FitAddon>()
  const [status, setStatus] = useState('Connecting')
  const [cwd, setCwd] = useState('')
  const dragRef = useRef<{ pointerId: number; startY: number; height: number }>()

  useEffect(() => {
    if (!snapshot.open) return
    const host = hostRef.current
    if (host === null) return
    const fontFamily = resolveTerminalFont(snapshot.fontFamily, host)
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontFamily,
      fontSize: snapshot.fontSize,
      theme: terminalTheme(host),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminalRef.current = terminal
    fitRef.current = fit
    const socket = new WebSocket(socketUrl())
    const filter = new WorkspaceFrameFilter()
    let opened = false
    let disposed = false
    let frame = 0

    const sendResize = (): void => {
      if (socket.readyState !== WebSocket.OPEN || !opened) return
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
    const fitTerminal = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return
        fit.fit()
        sendResize()
      })
    }
    const cancelOpen = openWhenSized(host, () => {
      void loadTerminalFont(fontFamily, snapshot.fontSize).then(() => {
        if (disposed || !host.isConnected) return
        terminal.open(host)
        opened = true
        fit.fit()
        terminal.refresh(0, terminal.rows - 1)
        sendResize()
        terminal.focus()
      })
    })
    const observer = new ResizeObserver(fitTerminal)
    observer.observe(host)
    const input = terminal.onData(data => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    socket.addEventListener('open', () => {
      const workspaceCwd = currentWorkspacePath(context.workspaces, context.sessions)
      socket.send(JSON.stringify({
        type: 'open',
        terminalId: snapshot.terminalId,
        ...(workspaceCwd === undefined ? {} : { cwd: workspaceCwd }),
      }))
      setStatus('Opening')
    })
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      let serverFrame: ServerFrame
      try { serverFrame = JSON.parse(event.data) as ServerFrame } catch { setStatus('Invalid server frame'); return }
      if (serverFrame.type === 'ready') {
        setCwd(serverFrame.cwd)
        setStatus('Ready')
        sendResize()
      } else if (serverFrame.type === 'output') {
        const filtered = filter.consume(serverFrame.data)
        if (filtered.visible.length > 0) terminal.write(filtered.visible)
        for (const action of filtered.actions) {
          if (action !== undefined) void handleWorkspaceAction(context, action, setStatus)
        }
      } else if (serverFrame.type === 'exit') {
        setStatus(`Exited (${String(serverFrame.code)})`)
      } else if (serverFrame.type === 'error') {
        setStatus(serverFrame.message)
      }
    })
    socket.addEventListener('close', () => setStatus('Disconnected'))
    socket.addEventListener('error', () => setStatus('Connection error'))

    return () => {
      disposed = true
      cancelOpen()
      cancelAnimationFrame(frame)
      observer.disconnect()
      input.dispose()
      if (store.getSnapshot().terminalId !== snapshot.terminalId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'close' }))
      }
      socket.close()
      terminal.dispose()
      terminalRef.current = undefined
      fitRef.current = undefined
    }
  }, [context, snapshot.open, snapshot.terminalId, store])

  useEffect(() => {
    const terminal = terminalRef.current
    const host = hostRef.current
    if (terminal === undefined || host === null) return
    const fontFamily = resolveTerminalFont(snapshot.fontFamily, host)
    let cancelled = false
    void loadTerminalFont(fontFamily, snapshot.fontSize).then(() => {
      if (cancelled || !host.isConnected) return
      terminal.options.fontFamily = fontFamily
      terminal.options.fontSize = snapshot.fontSize
      if (terminal.element !== undefined) terminal.refresh(0, terminal.rows - 1)
      fitRef.current?.fit()
    })
    return () => { cancelled = true }
  }, [snapshot.fontFamily, snapshot.fontSize])

  useEffect(() => {
    if (snapshot.open) terminalRef.current?.focus()
  }, [snapshot.focusGeneration, snapshot.open])

  if (!snapshot.open) return null

  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, height: snapshot.height }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    store.setHeight(drag.height + drag.startY - event.clientY)
  }
  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <section
    aria-label="Interactive terminal"
    data-dsh-keybinding-global
    style={{
      boxSizing: 'border-box', position: 'relative', height: snapshot.height, minHeight: 140, maxHeight: 'min(560px, 65vh)',
      width: 'calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance))',
      maxWidth: 'var(--dsh-composer-card-max-width)', marginInline: 'auto',
      display: 'grid', gridTemplateRows: '34px minmax(0, 1fr)', overflow: 'hidden',
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
      background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
      boxShadow: 'var(--dsw-elevation-panel)',
    }}
  >
    <div
      aria-label="Resize terminal"
      onPointerDown={startResize}
      onPointerMove={moveResize}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      style={{ position: 'absolute', inset: '-4px 0 auto', height: 8, cursor: 'ns-resize', touchAction: 'none', zIndex: 2 }}
    />
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: '0 8px 0 12px', borderBottom: '1px solid var(--dsw-alias-border-l2)', font: '12px/1 var(--dsw-font-family)' }}>
      <strong style={{ fontWeight: 600 }}>Terminal</strong>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-tertiary)' }}>{status}{cwd ? ` · ${cwd}` : ''}</span>
      <button type="button" aria-label="New terminal" title="New terminal" onClick={store.newTerminal} style={headerButtonStyle}>+</button>
      <button type="button" aria-label="Close terminal" title="Close terminal" onClick={store.close} style={headerButtonStyle}>×</button>
    </header>
    <div ref={hostRef} style={{ minWidth: 0, minHeight: 0, padding: '8px 10px', background: 'var(--dsw-alias-bg-base)' }} />
  </section>
}

const headerButtonStyle = {
  width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', font: '18px/24px var(--dsw-font-family)',
} as const

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${TERMINAL_PATH}`
}

function terminalTheme(host: HTMLElement) {
  const style = getComputedStyle(host)
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  return {
    background: token('--dsw-alias-bg-base', '#111114'),
    foreground: token('--dsw-alias-label-primary', '#e6e6e6'),
    cursor: token('--dsw-alias-label-primary', '#e6e6e6'),
    selectionBackground: token('--dsw-alias-interactive-bg-hover-accent', '#3959a8'),
  }
}

function openWhenSized(host: HTMLElement, open: () => void): () => void {
  let frame = 0
  const check = (): void => {
    if (!host.isConnected) return
    if (host.clientWidth > 0 && host.clientHeight > 0) open()
    else frame = requestAnimationFrame(check)
  }
  frame = requestAnimationFrame(check)
  return () => cancelAnimationFrame(frame)
}

async function handleWorkspaceAction(context: TerminalClientContext, action: WorkspaceAction, setStatus: (value: string) => void): Promise<void> {
  try {
    await runWorkspaceAction(context, action)
    setStatus('Workspace opened')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}
