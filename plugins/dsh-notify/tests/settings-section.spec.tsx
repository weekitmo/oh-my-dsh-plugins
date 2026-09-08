// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotifySettingsSection } from '../src/client/SettingsSection.tsx'
import { defaultNotificationSettings } from '../src/client/state.ts'
import { zh, type NotifyKey } from '../src/client/locales.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function translate(key: NotifyKey): string { return zh[key] }

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('DingTalk settings section', () => {
  it('masks both credentials and reveals each field independently', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const settings = defaultNotificationSettings()
    const useSettings = <T,>(selector: (value: typeof settings) => T): T => selector(settings)
    await act(async () => {
      root.render(<NotifySettingsSection
        useSettings={useSettings as never}
        set={() => {}}
        requestPermission={async () => 'denied'}
        sendTest={() => {}}
        loadDingTalk={async () => ({ configured: false, notifyCompleted: true, notifyFailed: true, quietHoursEnabled: false, quietHoursStart: '23:00', quietHoursEnd: '08:00', notifyMissed: false })}
        saveDingTalk={async value => ({ configured: true, ...value })}
        testDingTalk={async () => {}}
        t={translate as never}
        close={() => {}}
      />)
      await Promise.resolve()
    })
    const inputs = [...host.querySelectorAll<HTMLInputElement>('.dsh_notify_secretInput input')]
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.dsh_notify_secretInput button')]
    expect(inputs.map(input => input.type)).toEqual(['password', 'password'])
    expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    expect(buttons.map(button => button.querySelectorAll('svg path').length)).toEqual([1, 1])

    act(() => { buttons[0]!.click() })
    expect(inputs.map(input => input.type)).toEqual(['text', 'password'])
    expect(buttons.map(button => button.querySelectorAll('svg path').length)).toEqual([2, 1])
    expect(buttons[0]!.getAttribute('aria-label')).toBe(`${zh['settings.dingtalk.hideSecret']}: Access Token`)
    act(() => { buttons[0]!.click() })
    expect(inputs.map(input => input.type)).toEqual(['password', 'password'])
    act(() => { root.unmount() })
  })

  it('validates and saves notification body length from the settings page', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const settings = defaultNotificationSettings()
    const useSettings = <T,>(selector: (value: typeof settings) => T): T => selector(settings)
    const set = vi.fn()
    await act(async () => {
      root.render(<NotifySettingsSection
        useSettings={useSettings as never}
        set={set}
        requestPermission={async () => 'denied'}
        sendTest={() => {}}
        loadDingTalk={async () => ({ configured: false, notifyCompleted: true, notifyFailed: true, quietHoursEnabled: false, quietHoursStart: '23:00', quietHoursEnd: '08:00', notifyMissed: false })}
        saveDingTalk={async value => ({ configured: true, ...value })}
        testDingTalk={async () => {}}
        t={translate as never}
        close={() => {}}
      />)
      await Promise.resolve()
    })
    const input = host.querySelector<HTMLInputElement>('input[type=number]')!
    expect(input.min).toBe('100')
    expect(input.max).toBe('2000')

    const enter = (value: string): void => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    enter('99')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(set).not.toHaveBeenCalled()
    enter('2001')
    expect(set).not.toHaveBeenCalled()
    enter('1200')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(set).toHaveBeenLastCalledWith({ maxBodyChars: 1200 })
    act(() => { root.unmount() })
  })

  it('opens the official robot documentation in a protected new tab', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const root = createRoot(host)
    const settings = defaultNotificationSettings()
    const useSettings = <T,>(selector: (value: typeof settings) => T): T => selector(settings)
    await act(async () => {
      root.render(<NotifySettingsSection
        useSettings={useSettings as never}
        set={() => {}}
        requestPermission={async () => 'denied'}
        sendTest={() => {}}
        loadDingTalk={async () => ({ configured: false, notifyCompleted: true, notifyFailed: true, quietHoursEnabled: false, quietHoursStart: '23:00', quietHoursEnd: '08:00', notifyMissed: false })}
        saveDingTalk={async value => ({ configured: true, ...value })}
        testDingTalk={async () => {}}
        t={translate as never}
        close={() => {}}
      />)
      await Promise.resolve()
    })
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === zh['settings.dingtalk.docs'])
    expect(button).toBeDefined()
    act(() => { button!.click() })
    expect(open).toHaveBeenCalledWith(
      'https://open.dingtalk.com/document/dingstart/custom-bot-creation-and-installation',
      '_blank',
      'noopener,noreferrer',
    )
    act(() => { root.unmount() })
  })
})
