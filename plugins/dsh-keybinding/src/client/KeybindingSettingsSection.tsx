/** Main DSH Settings page for browser keyboard shortcuts. */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyBindingStorage } from '../core/keybindings.ts'
import { KEYBINDING_DEFINITIONS } from './keybinding-definitions.ts'
import { KeybindingSettings } from './keybinding-settings.tsx'
import { getTerminalWebFontFamilies, loadTerminalWebFont, normalizeTerminalFontFamily } from './terminal-font.ts'
import { TerminalFontSelect } from './TerminalFontSelect.tsx'
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
  const [webFonts, setWebFonts] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void loadTerminalWebFont().then(() => {
      if (active) setWebFonts(getTerminalWebFontFamilies())
    })
    return () => { active = false }
  }, [])
  const selectedFont = normalizeTerminalFontFamily(prefs.fontFamily)
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', width: '100%', minWidth: 0, gap: 18 }}>
    <section aria-label="终端外观" style={{ boxSizing: 'border-box', width: '100%', minWidth: 0, display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <h3 style={{ margin: 0 }}>终端</h3>
        <FontConfigHelp />
      </div>
      <div style={rowStyle}>
        <span style={rowLabelStyle}>字体</span>
        <TerminalFontSelect
          options={webFonts}
          value={selectedFont}
          onChange={terminal.setFontFamily}
        />
      </div>
      <label style={rowStyle}>
        <span style={rowLabelStyle}>字号</span>
        <input
          aria-label="终端字号"
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

function FontConfigHelp() {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 16, top: 16, width: 430 })
  const rootRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const anchor = rootRef.current?.getBoundingClientRect()
      const tooltip = tooltipRef.current?.getBoundingClientRect()
      if (anchor === undefined || tooltip === undefined) return
      const width = Math.min(430, window.innerWidth - 32)
      const left = Math.max(16, Math.min(anchor.left - 8, window.innerWidth - width - 16))
      const below = anchor.bottom + 7
      const top = below + tooltip.height <= window.innerHeight - 16 ? below : Math.max(16, anchor.top - tooltip.height - 7)
      setPosition({ left, top, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return <div
    ref={rootRef}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}
    style={{ position: 'relative' }}
  >
    <button
      type="button"
      aria-label="如何配置终端字体"
      aria-expanded={open}
      title="如何配置终端字体"
      onClick={() => setOpen(value => !value)}
      style={{
        width: 18, height: 18, display: 'grid', placeItems: 'center', padding: 0,
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '50%',
        background: open ? 'var(--dsw-alias-interactive-bg-hover-accent)' : 'transparent',
        color: open ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        font: '700 11px/1 var(--dsw-font-family)', cursor: 'pointer', letterSpacing: 0,
      }}
    >!</button>
    {open && <aside
      ref={tooltipRef}
      role="tooltip"
      style={{
        position: 'fixed', zIndex: 40, left: position.left, top: position.top, width: position.width,
        padding: 12, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        boxShadow: 'var(--dsw-elevation-panel)', font: '12px/1.6 var(--dsw-font-family)',
      }}
    >
      <div style={{ marginBottom: 7, fontWeight: 600 }}>DSH 会自动检测系统中可读取的等宽字体。</div>
      <div style={{ marginBottom: 7, color: 'var(--dsw-alias-label-secondary)' }}>如果字体未出现在列表中，可在 Web profile 的 cordis.patch.yml 中手动指定：</div>
      <pre style={{ margin: 0, padding: 9, overflowX: 'auto', borderRadius: 4, background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)', font: '11px/1.55 var(--ds-font-family-code)', whiteSpace: 'pre' }}>{`- id: weekit-keybinding
  config:
    webFont:
      family: Iosevka Nerd Font Mono
      path: /绝对路径/字体文件.ttf`}</pre>
      <div style={{ marginTop: 7, color: 'var(--dsw-alias-label-secondary)' }}>保存后重启 DSH Web。列表只显示通过等宽校验或手动指定、且可由本地 host 加载的字体。</div>
    </aside>}
  </div>
}

const rowStyle = {
  display: 'flex', width: '100%', minWidth: 0, boxSizing: 'border-box', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, color: 'var(--dsw-alias-label-primary)',
} as const

const rowLabelStyle = { flex: '1 1 100px' } as const

const inputStyle = {
  minWidth: 0, height: 32, padding: '0 9px', border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
  font: '13px var(--dsw-font-family)',
} as const
