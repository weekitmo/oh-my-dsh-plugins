/** Custom terminal font selector backed only by host-configured web fonts. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export function TerminalFontSelect({ options, value, onChange }: {
  options: readonly string[]
  value: string
  onChange(value: string): void
}) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const enabled = options.length > 0
  const selected = options.includes(value) ? value : ''

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const move = (offset: number): void => {
    if (!enabled) return
    const current = Math.max(0, options.indexOf(selected))
    onChange(options[(current + offset + options.length) % options.length] ?? '')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else move(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  return <div ref={rootRef} style={{ position: 'relative', minWidth: 0, maxWidth: 300, flex: '1 1 180px' }}>
    <button
      type="button"
      role="combobox"
      aria-label="终端字体"
      aria-controls={listboxId}
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={!enabled}
      onClick={() => setOpen(current => enabled && !current)}
      onKeyDown={onKeyDown}
      style={{
        boxSizing: 'border-box', width: '100%', height: 34, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', border: `1px solid ${open ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        borderRadius: 6, outline: 'none', background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-base))',
        color: selected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
        boxShadow: open ? '0 0 0 2px var(--dsw-alias-interactive-bg-hover-accent)' : 'none',
        font: '13px var(--dsw-font-family)', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.58,
        letterSpacing: 0,
      }}
    >
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
        {selected || (enabled ? '请选择字体' : '未配置可用字体')}
      </span>
      <span aria-hidden style={{ width: 7, height: 7, flex: '0 0 auto', borderRight: '1.5px solid currentColor', borderBottom: '1.5px solid currentColor', transform: `translateY(${open ? 2 : -2}px) rotate(${open ? 225 : 45}deg)`, transition: 'transform 120ms ease' }} />
    </button>
    {open && <div
      id={listboxId}
      role="listbox"
      aria-label="可用终端字体"
      style={{
        position: 'absolute', zIndex: 30, inset: 'calc(100% + 6px) 0 auto', maxHeight: 220, overflowY: 'auto',
        padding: 4, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
        background: 'var(--dsw-alias-bg-base)', boxShadow: 'var(--dsw-elevation-panel)',
      }}
    >
      {options.map(option => {
        const active = option === selected
        const highlighted = active || option === hovered
        return <button
          key={option}
          type="button"
          role="option"
          aria-selected={active}
          onMouseEnter={() => setHovered(option)}
          onMouseLeave={() => setHovered('')}
          onClick={() => { onChange(option); setOpen(false) }}
          style={{
            width: '100%', minHeight: 32, display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', alignItems: 'center',
            padding: '5px 8px', border: 0, borderRadius: 4,
            background: highlighted ? 'var(--dsw-alias-interactive-bg-hover-accent)' : 'transparent',
            color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
            font: '13px var(--dsw-font-family)', cursor: 'pointer', textAlign: 'left', letterSpacing: 0,
          }}
        >
          <span aria-hidden style={{ fontWeight: 700 }}>{active ? '✓' : ''}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option}</span>
        </button>
      })}
    </div>}
  </div>
}
