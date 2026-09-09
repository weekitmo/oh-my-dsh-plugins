import { useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronDown } from 'lucide-react'
import styles from './DelegateView.module.css'

export interface DelegateSelectOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
}

export function DelegateSelect<T extends string>({ value, options, label, disabled = false, onChange }: {
  readonly value: T
  readonly options: readonly DelegateSelectOption<T>[]
  readonly label: string
  readonly disabled?: boolean
  readonly onChange: (value: T) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value) ?? options[0]
  const items = useMemo<MenuEntry[]>(() => options.map(option => ({
    id: option.value,
    label: option.label,
    ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
  })), [options])

  const choose = (id: string): void => {
    const option = options.find(candidate => candidate.value === id)
    if (option === undefined || option.disabled === true) return
    onChange(option.value)
    setOpen(false)
  }

  const move = (direction: 1 | -1): void => {
    const enabled = options.filter(option => option.disabled !== true)
    if (enabled.length === 0) return
    const current = Math.max(0, enabled.findIndex(option => option.value === value))
    const next = enabled[(current + direction + enabled.length) % enabled.length]
    if (next !== undefined) onChange(next.value)
    setOpen(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = options.filter(option => option.disabled !== true)
      const next = event.key === 'Home' ? enabled[0] : enabled.at(-1)
      if (next !== undefined) onChange(next.value)
    }
  }

  return (
    <Menu
      open={open && !disabled}
      items={items}
      selectedId={value}
      portal
      compact
      onSelect={choose}
      onClose={() => { setOpen(false) }}
      className={styles.selectRoot ?? ''}
      anchor={(
        <button
          type="button"
          className={styles.selectTrigger}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onKeyDown={onKeyDown}
          onClick={() => { setOpen(current => !current) }}
        >
          <span>{selected?.label ?? value}</span>
          <ChevronDown size={14} className={open ? styles.selectChevronOpen : styles.selectChevron} />
        </button>
      )}
    />
  )
}
