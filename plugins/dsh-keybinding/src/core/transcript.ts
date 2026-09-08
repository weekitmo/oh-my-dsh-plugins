/** Bounded terminal output retention and private OSC filtering. */
import { OSC_BEL, WORKSPACE_OSC, parseWorkspaceAction } from './protocol.ts'

export class Transcript {
  private value = ''
  private dropped = false

  constructor(private readonly maxBytes = 1 << 20) {}

  append(data: string): string {
    return this.appendVisible(parseWorkspaceAction(data).visible)
  }

  appendVisible(visible: string): string {
    this.value += visible
    if (byteLength(this.value) > this.maxBytes) {
      const chars = Array.from(this.value)
      let bytes = 0
      let start = chars.length
      while (start > 0) {
        const next = byteLength(chars[start - 1] as string)
        if (bytes + next > this.maxBytes) break
        bytes += next
        start -= 1
      }
      this.value = chars.slice(start).join('')
      this.dropped = true
    }
    return visible
  }

  snapshot(): { data: string; truncated: boolean } {
    return { data: this.value, truncated: this.dropped }
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export class WorkspaceFrameFilter {
  private pending = ''

  consume(data: string): { visible: string; actions: ReturnType<typeof parseWorkspaceAction>['action'][] } {
    let visible = this.pending + data
    this.pending = ''
    const actions: ReturnType<typeof parseWorkspaceAction>['action'][] = []
    while (true) {
      const marker = visible.indexOf(WORKSPACE_OSC)
      if (marker === -1) {
        const partial = partialMarkerSuffix(visible)
        if (partial.length > 0) {
          this.pending = partial
          visible = visible.slice(0, -partial.length)
        }
        break
      }
      if (visible.indexOf(OSC_BEL, marker + WORKSPACE_OSC.length) === -1) {
        this.pending = visible.slice(marker)
        visible = visible.slice(0, marker)
        break
      }
      const result = parseWorkspaceAction(visible)
      if (result.action !== undefined) actions.push(result.action)
      visible = result.visible
    }
    return { visible, actions }
  }
}

function partialMarkerSuffix(value: string): string {
  const max = Math.min(value.length, WORKSPACE_OSC.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (value.endsWith(WORKSPACE_OSC.slice(0, length))) return value.slice(-length)
  }
  return ''
}
