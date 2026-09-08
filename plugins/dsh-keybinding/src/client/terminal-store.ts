/** Shared view preferences and commands for the embedded terminal. */
export interface TerminalUiSnapshot {
  readonly open: boolean
  readonly height: number
  readonly fontFamily: string
  readonly fontSize: number
  readonly terminalId: string
  readonly focusGeneration: number
}

export interface TerminalUiStore {
  getSnapshot(): TerminalUiSnapshot
  subscribe(listener: () => void): () => void
  toggle(): void
  close(): void
  focus(): void
  newTerminal(): void
  setHeight(height: number): void
  setFontFamily(fontFamily: string): void
  setFontSize(fontSize: number): void
}

const STORAGE_KEY = 'dsh-keybinding.terminal'
const DEFAULT_HEIGHT = 280
const DEFAULT_FONT_SIZE = 13

/**
 * Create the terminal's shared browser store.
 * @param storage - Browser persistence implementation.
 * @returns Observable terminal UI state and commands.
 */
export function createTerminalUiStore(storage: Storage = globalThis.localStorage): TerminalUiStore {
  let snapshot = readSnapshot(storage)
  const listeners = new Set<() => void>()
  const publish = (next: TerminalUiSnapshot): void => {
    snapshot = next
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        height: next.height,
        fontFamily: next.fontFamily,
        fontSize: next.fontSize,
      }))
    } catch { /* private browsing */ }
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggle: () => publish({ ...snapshot, open: !snapshot.open, focusGeneration: snapshot.focusGeneration + 1 }),
    close: () => publish({ ...snapshot, open: false }),
    focus: () => publish({ ...snapshot, open: true, focusGeneration: snapshot.focusGeneration + 1 }),
    newTerminal: () => publish({
      ...snapshot,
      open: true,
      terminalId: createTerminalId(),
      focusGeneration: snapshot.focusGeneration + 1,
    }),
    setHeight: height => publish({ ...snapshot, height: clampFinite(height, snapshot.height, 140, 560) }),
    setFontFamily: fontFamily => publish({ ...snapshot, fontFamily }),
    setFontSize: fontSize => publish({ ...snapshot, fontSize: clampFinite(Math.round(fontSize), snapshot.fontSize, 9, 32) }),
  }
}

function readSnapshot(storage: Storage): TerminalUiSnapshot {
  let saved: unknown
  try {
    const raw = storage.getItem(STORAGE_KEY)
    saved = raw === null ? undefined : JSON.parse(raw)
  } catch { saved = undefined }
  const value = isRecord(saved) ? saved : {}
  return {
    open: false,
    height: typeof value.height === 'number' ? clamp(value.height, 140, 560) : DEFAULT_HEIGHT,
    fontFamily: typeof value.fontFamily === 'string' ? value.fontFamily : '',
    fontSize: typeof value.fontSize === 'number' ? clamp(Math.round(value.fontSize), 9, 32) : DEFAULT_FONT_SIZE,
    terminalId: createTerminalId(),
    focusGeneration: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}

function clampFinite(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback
}

function createTerminalId(): string {
  return `terminal-${Math.random().toString(36).slice(2)}`
}
