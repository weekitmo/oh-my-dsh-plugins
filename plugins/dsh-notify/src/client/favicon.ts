const IDLE_COLOR = '#3964fe'

type SvgLoader = (href: string, signal: AbortSignal) => Promise<string>

export function colorizeFavicon(svg: string): string {
  return svg
    .replace(/fill=(['"])(?:#000000|#000|#ffffff|#fff)\1/gi, 'fill="' + IDLE_COLOR + '"')
    .replace(/fill:\s*(?:#000000|#000|#ffffff|#fff)/gi, 'fill: ' + IDLE_COLOR)
}

export class FaviconNotifier {
  private link: HTMLLinkElement | undefined
  private request = 0
  private pending = false
  private active = false
  private controller: AbortController | undefined
  private dataUrl: string | undefined

  constructor(
    private readonly target: Document = document,
    private readonly load: SvgLoader = async (href, signal) => {
      const response = await fetch(href, { signal })
      if (!response.ok) throw new Error('favicon request failed: ' + String(response.status))
      return response.text()
    },
  ) {}

  render(active: boolean): void {
    this.active = active
    if (!active) {
      this.dispose()
      return
    }
    if (this.dataUrl !== undefined) {
      this.install(this.dataUrl)
      return
    }
    if (this.pending) return
    const source = this.target.querySelector<HTMLLinkElement>('link[rel~="icon"]:not([data-dsh-notify-favicon])')
    if (source === null) return
    const request = ++this.request
    const controller = new AbortController()
    this.controller = controller
    this.pending = true
    void this.load(source.href, controller.signal).then(svg => {
      if (request !== this.request || !this.active) return
      this.dataUrl = 'data:image/svg+xml,' + encodeURIComponent(colorizeFavicon(svg))
      this.install(this.dataUrl)
    }).catch(() => { /* Keep the host favicon when it cannot be loaded. */ }).finally(() => {
      if (request !== this.request) return
      this.pending = false
      this.controller = undefined
    })
  }

  dispose(): void {
    this.active = false
    this.pending = false
    this.controller?.abort()
    this.controller = undefined
    this.request += 1
    this.link?.remove()
    this.link = undefined
  }

  private install(href: string): void {
    const link = this.link?.isConnected === true ? this.link : this.target.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.dataset.dshNotifyFavicon = ''
    link.href = href
    if (!link.isConnected) this.target.head.append(link)
    this.link = link
  }
}
