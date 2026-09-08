import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))

import { apply } from '../src/client/index.tsx'
import type { Context } from '../src/client/types.ts'

describe('client settings registration', () => {
  it('registers a main Settings section with every shortcut', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '@font-face { font-family: "Iosevka Nerd Font Mono"; src: url(/dsh-terminal/font-file); }',
      { status: 200, headers: { 'content-type': 'text/css' } },
    )))
    const registrations: Array<{ options: { name: string; id: string; label?: string | (() => string); inject?: () => Record<string, unknown> }; component: (props: Record<string, unknown>) => unknown }> = []
    const services: Record<string, unknown> = {
      workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: vi.fn() }, create: vi.fn() },
      sessions: { list: { getSnapshot: () => ({}), subscribe: vi.fn() }, open: vi.fn() },
      uiWorkspace: { connectWorkspace: vi.fn(), startSession: vi.fn() },
      layout: { toggleSidebar: vi.fn() },
    }
    const context: Context = {
      slots: {
        inject(_name, callback) { callback() },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      },
      get(service) { return services[service] as never },
    }

    apply(context)

    expect(registrations.map(entry => entry.options.name)).toEqual([
      'shell.overlay', 'conversation.input.left', 'conversation.input.dock', 'settings.section',
    ])
    const section = registrations.find(entry => entry.options.name === 'settings.section')
    expect(section?.options).toMatchObject({ id: 'keybindings', label: '快捷键' })
    if (section === undefined) throw new Error('keybinding settings section was not registered')
    render(section.component(section.options.inject?.() ?? {}) as never)
    expect(screen.getByRole('heading', { name: '键盘快捷键' })).toBeTruthy()
    const fontSelect = screen.getByRole('combobox', { name: '终端字体' })
    expect(fontSelect).toBeTruthy()
    await screen.findByText('Iosevka Nerd Font Mono')
    fireEvent.click(fontSelect)
    expect(await screen.findByRole('option', { name: 'Iosevka Nerd Font Mono' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: '终端字号' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '如何配置终端字体' }))
    expect(screen.getByRole('tooltip').textContent).toContain('自动检测系统中可读取的等宽字体')
    expect(screen.getByRole('tooltip').textContent).toContain('cordis.patch.yml')
    expect(screen.getByRole('tooltip').textContent).toContain('webFont')
    expect(screen.getByRole('region', { name: '键盘快捷键' }).querySelectorAll('input')).toHaveLength(6)
  })
})
