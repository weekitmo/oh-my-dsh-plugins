/** Keyboard recorder: captures one normalized combination and persists through its caller. */
import { useRef, useState, type KeyboardEvent } from 'react'
import { normalizeKeyboardEvent, normalizeShortcut } from '../core/keybindings.ts'

const MODIFIER_BUTTONS = ['Shift', 'Ctrl', 'Command', 'Alt'] as const
type ModifierButton = typeof MODIFIER_BUTTONS[number]

export interface ShortcutRecorderProps {
  value: string
  onChange(value: string): void
  label: string
}

/**
 * Render an input-like shortcut recorder with an explicit listening state.
 * @param props - Current binding, label, and update callback.
 * @returns A labeled keyboard capture field.
 */
export function ShortcutRecorder({ value, onChange, label }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState('')
  const [selectedModifiers, setSelectedModifiers] = useState<readonly ModifierButton[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const start = (): void => {
    setRecording(true)
    setPreview('')
    setSelectedModifiers([])
    inputRef.current?.focus()
  }

  const stop = (): void => {
    setRecording(false)
    setPreview('')
    setSelectedModifiers([])
  }

  const toggleModifier = (modifier: ModifierButton): void => {
    setSelectedModifiers(current => current.includes(modifier)
      ? current.filter(item => item !== modifier)
      : [...current, modifier])
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    if (event.key === 'Escape') {
      stop()
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Backspace') {
      onChange('')
      stop()
      inputRef.current?.blur()
      return
    }
    const normalized = normalizeShortcut([
      ...selectedModifiers.map(modifierToken),
      event.metaKey ? (isMacPlatform() ? 'Mod' : 'Meta') : '',
      event.ctrlKey ? (isMacPlatform() ? 'Ctrl' : 'Mod') : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      isModifierKey(event.key) ? '' : event.key,
    ]) || normalizeKeyboardEvent(event.nativeEvent)
    const modifierPreview = normalizeShortcut([
      ...selectedModifiers.map(modifierToken),
      event.metaKey ? (isMacPlatform() ? 'Mod' : 'Meta') : '',
      event.ctrlKey ? (isMacPlatform() ? 'Ctrl' : 'Mod') : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      isModifierKey(event.key) ? '' : event.key,
    ])
    setPreview(modifierPreview || normalized || modifierOnlyPreview(event))
    if (normalized.length === 0) return
    onChange(normalized)
    stop()
    inputRef.current?.blur()
  }

  const displayValue = recording
    ? preview === '' ? '请按下快捷键…' : formatShortcut(preview)
    : value === '' ? '未设置' : formatShortcut(value)

  return <label style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
    <span style={{ minWidth: 0, flex: '1 1 110px', color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{label}</span>
    <div style={{ display: 'grid', minWidth: 0, width: '100%', maxWidth: 260, flex: '1 1 190px', gap: recording ? 6 : 0 }}>
      <input
        ref={inputRef}
        readOnly
        value={displayValue}
        aria-label={label}
        aria-keyshortcuts={value || undefined}
        data-recording={recording ? 'true' : 'false'}
        data-dsh-keybinding-recorder
        onFocus={() => { if (!recording) start() }}
        onClick={start}
        onBlur={stop}
        onKeyDownCapture={onKeyDown}
        style={{
          boxSizing: 'border-box', width: '100%', minWidth: 0, height: 36, padding: '0 10px',
          border: `1px solid ${recording ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
          borderRadius: recording ? '6px 6px 3px 3px' : 6, outline: 'none',
          background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-base))',
          color: recording ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
          boxShadow: recording ? '0 0 0 2px var(--dsw-alias-interactive-bg-hover-accent)' : 'none',
          font: '500 13px/34px var(--ds-font-family-code)', textAlign: 'left', cursor: 'text', letterSpacing: 0,
        }}
      />
      {recording && <div aria-label="快捷键修饰键" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {MODIFIER_BUTTONS.map(modifier => {
          const selected = selectedModifiers.includes(modifier)
          return <button
            key={modifier}
            type="button"
            aria-label={`${modifier} 修饰键`}
            aria-pressed={selected}
            onMouseDown={event => event.preventDefault()}
            onClick={() => toggleModifier(modifier)}
            style={{
              height: 24, padding: '0 7px', border: `1px solid ${selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
              borderRadius: 4, background: selected ? 'var(--dsw-alias-interactive-bg-hover-accent)' : 'transparent',
              color: selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
              font: '500 11px/22px var(--dsw-font-family)', cursor: 'pointer', letterSpacing: 0,
            }}
          >{modifier}</button>
        })}
      </div>}
    </div>
  </label>
}

function modifierOnlyPreview(event: KeyboardEvent<HTMLInputElement>): string {
  return [
    event.metaKey ? (isMacPlatform() ? 'Mod' : 'Meta') : '',
    event.ctrlKey ? (isMacPlatform() ? 'Ctrl' : 'Mod') : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
  ].filter(Boolean).join('+')
}

function modifierToken(modifier: ModifierButton): string {
  if (modifier === 'Command') return isMacPlatform() ? 'Mod' : 'Meta'
  if (modifier === 'Ctrl') return isMacPlatform() ? 'Ctrl' : 'Mod'
  return modifier
}

function isModifierKey(key: string): boolean {
  return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta'
}

function formatShortcut(shortcut: string): string {
  if (!isMacPlatform()) return shortcut
  return shortcut.split('+').map(part => ({ Mod: 'Command', Meta: 'Command', Ctrl: 'Control', Alt: 'Option', Shift: 'Shift' })[part] ?? part).join(' + ')
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}
