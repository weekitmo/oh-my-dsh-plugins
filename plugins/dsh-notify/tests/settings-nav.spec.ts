// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsNavBell } from '../src/client/settings-nav.ts'

let observers: MutationObserver[]

beforeEach(() => {
  document.body.innerHTML = ''
  observers = []
  vi.stubGlobal('MutationObserver', class {
    constructor(readonly callback: MutationCallback) { observers.push(this as unknown as MutationObserver) }
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  })
})

afterEach(() => { vi.unstubAllGlobals() })

function nav(label = '通知') {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const button = document.createElement('button')
  button.append(Object.assign(document.createElement('svg'), { innerHTML: '<path data-default="true" />' }))
  button.append(document.createTextNode(label))
  dialog.append(button)
  document.body.append(dialog)
  return button
}

describe('SettingsNavBell', () => {
  it('replaces only the notification settings gear with a bell and restores it on disposal', () => {
    const notifications = nav()
    const models = nav('模型')
    const bell = new SettingsNavBell(document, () => '通知')
    bell.start()

    const renderedBell = notifications.querySelector<SVGSVGElement>('[data-dsh-notify-nav-bell]')
    expect(renderedBell).not.toBeNull()
    expect(renderedBell?.getAttribute('width')).toBe('16')
    expect(renderedBell?.getAttribute('height')).toBe('16')
    expect(notifications.hasAttribute('data-dsh-notify-nav-bell-host')).toBe(true)
    expect(notifications.querySelector('[data-default="true"]')).not.toBeNull()
    expect(models.querySelector('[data-dsh-notify-nav-bell]')).toBeNull()
    expect(models.querySelector('[data-default="true"]')).not.toBeNull()

    bell.dispose()
    expect(notifications.querySelector('[data-dsh-notify-nav-bell]')).toBeNull()
    expect(notifications.querySelector('[data-default="true"]')).not.toBeNull()
  })

  it('attaches after the settings dialog mounts', () => {
    const bell = new SettingsNavBell(document, () => '通知')
    bell.start()
    const button = nav()
    observers[0]?.callback([], document.defaultView?.MutationObserver ?? ({} as MutationObserver))

    expect(button.querySelector('[data-dsh-notify-nav-bell]')).not.toBeNull()
    bell.dispose()
  })
})
