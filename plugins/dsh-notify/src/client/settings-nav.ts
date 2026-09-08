/** Replaces only dsh-notify's settings-nav gear with a self-contained bell SVG. */
const HOST_ATTR = 'data-dsh-notify-nav-bell-host'
const BELL_ATTR = 'data-dsh-notify-nav-bell'

function navButton(root: Document, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find(button => button.textContent?.trim() === label)
}

function bellSvg(root: Document): SVGSVGElement {
  const bell = root.createElementNS('http://www.w3.org/2000/svg', 'svg')
  bell.setAttribute(BELL_ATTR, '')
  bell.setAttribute('width', '16')
  bell.setAttribute('height', '16')
  bell.style.display = 'block'
  bell.style.flex = '0 0 16px'
  bell.style.width = '16px'
  bell.style.height = '16px'
  bell.setAttribute('viewBox', '0 0 24 24')
  bell.setAttribute('fill', 'none')
  bell.setAttribute('aria-hidden', 'true')
  bell.setAttribute('focusable', 'false')
  const body = root.createElementNS('http://www.w3.org/2000/svg', 'path')
  body.setAttribute('d', 'M18 8A6 6 0 0 0 6 8c0 7-3 7-3 9h18c0-2-3-2-3-9Z')
  body.setAttribute('stroke', 'currentColor')
  body.setAttribute('stroke-width', '1.8')
  body.setAttribute('stroke-linecap', 'round')
  body.setAttribute('stroke-linejoin', 'round')
  const clapper = root.createElementNS('http://www.w3.org/2000/svg', 'path')
  clapper.setAttribute('d', 'M10 21h4')
  clapper.setAttribute('stroke', 'currentColor')
  clapper.setAttribute('stroke-width', '1.8')
  clapper.setAttribute('stroke-linecap', 'round')
  bell.append(body, clapper)
  return bell
}

function clear(root: Document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(`[${HOST_ATTR}]`)) {
    button.querySelector<SVGSVGElement>(`svg[${BELL_ATTR}]`)?.remove()
    button.removeAttribute(HOST_ATTR)
  }
}

/** Keeps the plugin settings nav row marked with a bell as the shell re-renders. */
export class SettingsNavBell {
  private observer: MutationObserver | undefined

  constructor(
    private readonly root: Document = document,
    private readonly label: () => string,
  ) {}

  start(): void {
    if (this.observer !== undefined || this.root.body === null) return
    this.observer = new MutationObserver(() => { this.sync() })
    this.sync()
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = undefined
    clear(this.root)
  }

  private sync(): void {
    this.observer?.disconnect()
    clear(this.root)
    const button = navButton(this.root, this.label())
    if (button !== undefined) {
      const defaultIcon = [...button.children].find(child => child.localName === 'svg')
      if (defaultIcon !== undefined) {
        button.setAttribute(HOST_ATTR, '')
        defaultIcon.before(bellSvg(this.root))
      }
    }
    if (this.observer !== undefined && this.root.body !== null) {
      this.observer.observe(this.root.body, { childList: true, subtree: true, characterData: true })
    }
  }
}
