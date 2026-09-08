/** Main DSH Settings page for browser keyboard shortcuts. */
import { useSyncExternalStore } from 'react'
import type { KeyBindingStorage } from '../core/keybindings.ts'
import { KEYBINDING_DEFINITIONS } from './keybinding-definitions.ts'
import { KeybindingSettings } from './keybinding-settings.tsx'
import type { TerminalUiStore } from './terminal-store.ts'

export interface KeybindingSettingsSectionProps {
  storage: KeyBindingStorage
  terminal: TerminalUiStore
}

/**
 * Render every plugin shortcut in the DSH Settings content column.
 * @param props - Shared browser storage injected by the client plugin.
 * @returns The keyboard shortcut editor.
 */
export function KeybindingSettingsSection({ storage, terminal }: KeybindingSettingsSectionProps) {
  const prefs = useSyncExternalStore(terminal.subscribe, terminal.getSnapshot)
  return <div style={{ display: 'grid', gap: 18 }}>
    <section aria-label="Terminal appearance" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <h3 style={{ margin: 0 }}>Terminal</h3>
      <label style={rowStyle}>
        <span>Font family</span>
        <input
          aria-label="Terminal font family"
          value={prefs.fontFamily}
          placeholder="Maple Mono NF CN"
          onChange={event => terminal.setFontFamily(event.currentTarget.value)}
          style={inputStyle}
        />
      </label>
      <label style={rowStyle}>
        <span>Font size</span>
        <input
          aria-label="Terminal font size"
          type="number"
          min={9}
          max={32}
          value={prefs.fontSize}
          onChange={event => terminal.setFontSize(event.currentTarget.valueAsNumber)}
          style={{ ...inputStyle, width: 88 }}
        />
      </label>
    </section>
    <KeybindingSettings storage={storage} definitions={KEYBINDING_DEFINITIONS} />
  </div>
}

const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(180px, 300px)',
  alignItems: 'center', gap: 12, color: 'var(--dsw-alias-label-primary)',
} as const

const inputStyle = {
  minWidth: 0, height: 32, padding: '0 9px', border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
  font: '13px var(--dsw-font-family)',
} as const
