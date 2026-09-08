/** Wire protocol shared by the independent DSH Web terminal host and client. */

export const TERMINAL_PATH = '/dsh-terminal/ws'
export const WORKSPACE_OSC = '\u001b]777;dsh-workspace;'
export const OSC_BEL = '\u0007'

export type ClientFrame =
  | { type: 'open'; terminalId: string; cwd?: string }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'close' }

export type ServerFrame =
  | { type: 'output'; data: string }
  | { type: 'ready'; terminalId: string; cwd: string }
  | { type: 'exit'; code: number; signal?: string }
  | { type: 'error'; message: string }

export interface WorkspaceAction {
  action: 'add' | 'open'
  cwd: string
}

export function encodeFrame(frame: ServerFrame): string {
  return JSON.stringify(frame)
}

export function parseClientFrame(value: unknown): ClientFrame | undefined {
  if (typeof value !== 'string') return undefined
  let frame: unknown
  try { frame = JSON.parse(value) } catch { return undefined }
  if (!isRecord(frame) || typeof frame.type !== 'string') return undefined
  switch (frame.type) {
    case 'open':
      return typeof frame.terminalId === 'string' && isSafeId(frame.terminalId)
        ? { type: 'open', terminalId: frame.terminalId, ...(typeof frame.cwd === 'string' ? { cwd: frame.cwd } : {}) }
        : undefined
    case 'input':
      return typeof frame.data === 'string' ? { type: 'input', data: frame.data } : undefined
    case 'resize':
      return positiveInt(frame.cols) && positiveInt(frame.rows)
        ? { type: 'resize', cols: frame.cols as number, rows: frame.rows as number }
        : undefined
    case 'close':
      return { type: 'close' }
    default:
      return undefined
  }
}

export function parseWorkspaceAction(data: string): { visible: string; action?: WorkspaceAction } {
  const start = data.indexOf(WORKSPACE_OSC)
  if (start === -1) return { visible: data }
  const end = data.indexOf(OSC_BEL, start + WORKSPACE_OSC.length)
  if (end === -1) return { visible: data }
  const payload = data.slice(start + WORKSPACE_OSC.length, end)
  const [kind, encoded] = payload.split(';', 2)
  let cwd: string | undefined
  try {
    cwd = encoded?.startsWith('b64:')
      ? decodeBase64Utf8(encoded.slice(4))
      : encoded === undefined ? undefined : decodeURIComponent(encoded)
  } catch { cwd = undefined }
  const action = (kind === 'add' || kind === 'open') && cwd !== undefined && cwd.length > 0
    ? { action: kind, cwd } as WorkspaceAction
    : undefined
  // Private frames are never terminal-visible, including malformed actions.
  return { visible: data.slice(0, start) + data.slice(end + OSC_BEL.length), ...(action === undefined ? {} : { action }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function decodeBase64Utf8(value: string): string {
  if (typeof globalThis.atob === 'function') {
    const bytes = Uint8Array.from(globalThis.atob(value), char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return ''
}

function isSafeId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)
}
