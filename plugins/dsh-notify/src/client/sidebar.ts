import type { AttentionEntry } from '../contract.ts'

const INDICATOR_ATTR = 'data-dsh-notify-indicator'
const HOST_CLASS = 'dsh_notify_indicatorHost'

function leafWithText(row: HTMLElement, title: string): HTMLElement | undefined {
  return [...row.querySelectorAll<HTMLElement>('span')].find(element =>
    element.children.length === 0 && element.textContent?.trim() === title,
  )
}

function isStatusSlot(element: HTMLElement): boolean {
  return [...element.classList].some(name => /(?:^|[-_])slot(?:[-_]|$)/iu.test(name))
}

function removeIndicators(root: ParentNode): void {
  for (const marker of root.querySelectorAll<HTMLElement>(`[${INDICATOR_ATTR}]`)) {
    const host = marker.parentElement
    marker.remove()
    if (host?.classList.contains(HOST_CLASS) === true) {
      host.classList.remove(HOST_CLASS)
      if (host.getAttribute('data-dsh-notify-created-host') === 'true') host.remove()
      else host.removeAttribute('data-dsh-notify-created-host')
    }
  }
}

export class SidebarIndicators {
  private entries: readonly AttentionEntry[] = []
  private enabled = true
  private observer: MutationObserver | undefined
  private frame: number | undefined
  private rendering = false
  private warnedTitles = new Set<string>()

  constructor(private readonly root: Document = document) {}

  start(): void {
    if (this.observer !== undefined || this.root.body === null) return
    this.observer = new MutationObserver(() => {
      if (!this.rendering) this.scheduleRender()
    })
    this.observer.observe(this.root.body, { childList: true, subtree: true })
    this.renderNow()
  }

  render(entries: readonly AttentionEntry[], enabled: boolean): void {
    this.entries = entries
    this.enabled = enabled
    this.scheduleRender()
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = undefined
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    removeIndicators(this.root)
  }

  private scheduleRender(): void {
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.renderNow()
    })
  }

  private renderNow(): void {
    this.rendering = true
    this.observer?.disconnect()
    removeIndicators(this.root)
    if (this.enabled) this.mountIndicators()
    if (this.observer !== undefined && this.root.body !== null) {
      this.observer.observe(this.root.body, { childList: true, subtree: true })
    }
    this.rendering = false
  }

  private mountIndicators(): void {
    const byTitle = new Map<string, AttentionEntry[]>()
    for (const entry of this.entries) {
      const group = byTitle.get(entry.title) ?? []
      group.push(entry)
      byTitle.set(entry.title, group)
    }
    const rows = [...this.root.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected]')]
    for (const [title, entries] of byTitle) {
      if (entries.length !== 1) {
        if (!this.warnedTitles.has(title)) {
          console.warn(`[dsh-notify] sidebar indicator skipped for duplicate session title: ${title}`)
          this.warnedTitles.add(title)
        }
        continue
      }
      const entry = entries[0]
      if (entry === undefined) continue
      const matches = rows.flatMap(row => {
        const titleElement = leafWithText(row, title)
        return titleElement === undefined ? [] : [titleElement]
      })
      if (matches.length !== 1) {
        if (matches.length > 1 && !this.warnedTitles.has(title)) {
          console.warn(`[dsh-notify] sidebar indicator skipped for duplicate visible session title: ${title}`)
          this.warnedTitles.add(title)
        }
        continue
      }
      const titleElement = matches[0]
      if (titleElement === undefined) continue
      const host = titleElement.previousElementSibling as HTMLElement | null
      if (host === null || host.tagName !== 'SPAN' || !isStatusSlot(host)) continue
      const nativeState = host.querySelector<HTMLElement>('[data-state]')?.getAttribute('data-state')
      if (nativeState === 'ongoing' || nativeState === 'warning') continue
      host.classList.add(HOST_CLASS)
      const marker = this.root.createElement('span')
      marker.setAttribute(INDICATOR_ATTR, '')
      marker.setAttribute('data-tone', entry.tone)
      marker.setAttribute('aria-hidden', 'true')
      marker.title = entry.reason
      host.appendChild(marker)
    }
  }
}
