/** Compact Terminal toggle for DSH's composer tool row. */
import { useSyncExternalStore } from 'react'
import type { TerminalUiStore } from './terminal-store.ts'

/**
 * Render the terminal toggle in the composer toolbar.
 * @param props - Shared terminal view store.
 * @returns A compact icon button.
 */
export function TerminalControl({ store }: { store: TerminalUiStore }) {
  const open = useSyncExternalStore(store.subscribe, store.getSnapshot).open
  return <button
    type="button"
    data-dsh-keybinding-global
    aria-label={open ? 'Hide terminal' : 'Show terminal'}
    title={open ? 'Hide terminal' : 'Show terminal'}
    aria-pressed={open}
    onClick={store.toggle}
    style={{
      display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0,
      border: 0, borderRadius: 8, background: open ? 'var(--dsw-alias-interactive-bg-hover-accent)' : 'transparent',
      color: open ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
    }}
  >
    <span aria-hidden style={{ font: '600 13px/1 var(--ds-font-family-code)' }}>&gt;_</span>
  </button>
}
