/** Vimium-style keyboard hints for visible DSH workspace and session rows. */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const HINT_KEYS = 'ASDFGHJKLQWERTYUIOPZXCVBNM'
const TREE_SELECTOR = '#root [role="tree"]'
const ITEM_SELECTOR = ':scope [role="treeitem"]'

export interface WorkspaceHint {
  readonly label: string
  readonly element: HTMLElement
  readonly name: string
  readonly top: number
  readonly left: number
}

/**
 * Assign compact home-row-first labels in visible item order.
 * @param count - Number of visible workspace and session rows.
 * @returns One unique uppercase label per row.
 */
export function workspaceHintLabels(count: number): string[] {
  if (count <= HINT_KEYS.length) return [...HINT_KEYS.slice(0, count)]
  let width = 2
  while (HINT_KEYS.length ** width < count) width += 1
  return Array.from({ length: count }, (_, index) => encodeHint(index, width))
}

/**
 * Render and operate a workspace/session hint overlay.
 * @param props - Monotonic activation token supplied by the global shortcut.
 * @returns Fixed buttons positioned over visible sidebar tree rows.
 */
export function WorkspaceHints({ activation }: { activation: number }) {
  const [active, setActive] = useState(false)
  const [typed, setTyped] = useState('')
  const [hints, setHints] = useState<readonly WorkspaceHint[]>([])

  const measure = useCallback(() => {
    const tree = document.querySelector<HTMLElement>(TREE_SELECTOR)
    if (tree === null) {
      setHints([])
      return
    }
    const treeRect = tree.getBoundingClientRect()
    const visible = [...tree.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
        && rect.bottom > Math.max(0, treeRect.top)
        && rect.top < Math.min(innerHeight, treeRect.bottom)
    })
    const labels = workspaceHintLabels(visible.length)
    setHints(visible.map((element, index) => {
      const rect = element.getBoundingClientRect()
      return {
        label: labels[index] ?? '', element, name: itemName(element),
        top: rect.top + Math.max(3, (rect.height - 22) / 2),
        left: rect.right - 27,
      }
    }))
  }, [])

  useEffect(() => {
    if (activation === 0) return
    setTyped('')
    setActive(true)
  }, [activation])

  useLayoutEffect(() => {
    if (!active) return
    measure()
    const observer = new MutationObserver(measure)
    const tree = document.querySelector(TREE_SELECTOR)
    const root = document.querySelector('#root')
    observer.observe(tree ?? root ?? document.body, { childList: true, subtree: true })
    addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [active, measure])

  const select = useCallback((hint: WorkspaceHint): void => {
    setActive(false)
    hint.element.click()
  }, [])

  useEffect(() => {
    if (!active) return
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setActive(false)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || !/[a-z]/i.test(event.key)) return
      const next = `${typed}${event.key.toUpperCase()}`
      const matches = hints.filter(hint => hint.label.startsWith(next))
      event.preventDefault()
      event.stopImmediatePropagation()
      if (matches.length === 0) {
        setActive(false)
        return
      }
      const exact = matches.find(hint => hint.label === next)
      if (exact !== undefined) select(exact)
      else setTyped(next)
    }
    document.addEventListener('keydown', listener, true)
    return () => document.removeEventListener('keydown', listener, true)
  }, [active, hints, select, typed])

  if (!active) return null
  return createPortal(<div aria-label="Workspace and session hints" data-dsh-keybinding-global style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
    {hints.filter(hint => hint.label.startsWith(typed)).map(hint => <button
      key={hint.label}
      type="button"
      aria-label={`${hint.name}: ${hint.label}`}
      onClick={() => select(hint)}
      style={{
        boxSizing: 'border-box', position: 'fixed', top: hint.top, left: hint.left,
        minWidth: 22, height: 22, padding: '0 4px', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 4, background: 'var(--dsw-alias-button-info-fill)', pointerEvents: 'auto', cursor: 'pointer',
        color: 'var(--dsw-alias-button-info-label)', boxShadow: 'var(--dsw-elevation-soft)',
        font: '700 11px/20px var(--dsw-font-family)', textAlign: 'center', letterSpacing: 0,
      }}
    >{typed === '' ? hint.label : hint.label.slice(typed.length)}</button>)}
  </div>, document.body)
}

function itemName(element: HTMLElement): string {
  const title = element.querySelector<HTMLElement>('[title]')?.getAttribute('title')?.trim()
  return title || element.textContent?.trim() || 'Sidebar item'
}

function encodeHint(index: number, width: number): string {
  let value = index
  let result = ''
  for (let position = 0; position < width; position += 1) {
    result = HINT_KEYS[value % HINT_KEYS.length] + result
    value = Math.floor(value / HINT_KEYS.length)
  }
  return result
}
