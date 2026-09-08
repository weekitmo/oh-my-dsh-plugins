// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttentionEntry } from '../src/contract.ts'
import { SidebarIndicators } from '../src/client/sidebar.ts'

function entry(sessionId: string, title: string, tone: AttentionEntry['tone']): AttentionEntry {
  return {
    sessionId,
    turn: 1,
    reason: tone === 'success' ? 'completed' : 'error',
    tone,
    title,
    body: '',
    createdAt: 1,
  }
}

let frames: FrameRequestCallback[]

beforeEach(() => {
  document.body.innerHTML = ''
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function flushFrame(): void {
  const callback = frames.shift()
  callback?.(0)
}

function row(title: string): HTMLElement {
  const item = document.createElement('div')
  item.setAttribute('role', 'treeitem')
  item.setAttribute('aria-selected', 'false')
  item.innerHTML = '<span class="slot"><span data-state="done"></span></span><span class="title"></span>'
  const titleElement = item.querySelector<HTMLElement>('.title')
  if (titleElement !== null) titleElement.textContent = title
  document.body.appendChild(item)
  return item
}

describe('SidebarIndicators', () => {
  it('replaces native completion dots with green and red plugin markers', () => {
    const done = row('Build docs')
    const failed = row('Deploy app')
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([
      entry('a', 'Build docs', 'success'),
      entry('b', 'Deploy app', 'error'),
    ], true)
    flushFrame()

    expect(done.querySelector('[data-dsh-notify-indicator]')?.getAttribute('data-tone')).toBe('success')
    expect(failed.querySelector('[data-dsh-notify-indicator]')?.getAttribute('data-tone')).toBe('error')
    indicators.dispose()
    expect(document.querySelectorAll('[data-dsh-notify-indicator]')).toHaveLength(0)
  })

  it('skips a row without a status slot', () => {
    const item = document.createElement('div')
    item.setAttribute('role', 'treeitem')
    item.setAttribute('aria-selected', 'false')
    item.innerHTML = '<span class="title">No slot</span>'
    document.body.appendChild(item)
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([entry('a', 'No slot', 'success')], true)
    flushFrame()

    expect(item.querySelector('[data-dsh-notify-indicator]')).toBeNull()
    indicators.dispose()
  })

  it('skips a non-slot span before the title', () => {
    const item = row('Build docs')
    item.querySelector<HTMLElement>('.slot')?.classList.replace('slot', 'icon')
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([entry('a', 'Build docs', 'success')], true)
    flushFrame()

    expect(item.querySelector('[data-dsh-notify-indicator]')).toBeNull()
    indicators.dispose()
  })

  it('keeps native running and waiting states ahead of unread markers', () => {
    const running = row('Build docs')
    running.querySelector('[data-state]')?.setAttribute('data-state', 'ongoing')
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([entry('a', 'Build docs', 'success')], true)
    flushFrame()

    expect(running.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(running.querySelector('[data-dsh-notify-indicator]')).toBeNull()
    indicators.dispose()
  })

  it('removes markers when disabled', () => {
    row('Build docs')
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([entry('a', 'Build docs', 'success')], true)
    flushFrame()
    expect(document.querySelector('[data-dsh-notify-indicator]')).not.toBeNull()

    indicators.render([], false)
    flushFrame()
    expect(document.querySelector('[data-dsh-notify-indicator]')).toBeNull()
    indicators.dispose()
  })

  it('skips duplicate visible titles instead of guessing a session id', () => {
    row('Same title')
    row('Same title')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const indicators = new SidebarIndicators(document)
    indicators.start()
    indicators.render([entry('a', 'Same title', 'error')], true)
    flushFrame()

    expect(document.querySelector('[data-dsh-notify-indicator]')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate visible session title'))
    indicators.dispose()
  })
})
