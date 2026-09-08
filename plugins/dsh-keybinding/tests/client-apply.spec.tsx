import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))

import { apply } from '../src/client/index.tsx'
import type { Context } from '../src/client/types.ts'

describe('client settings registration', () => {
  it('registers a main Settings section with every shortcut', () => {
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
    expect(section?.options).toMatchObject({ id: 'keybindings', label: 'Keybindings' })
    if (section === undefined) throw new Error('keybinding settings section was not registered')
    render(section.component(section.options.inject?.() ?? {}) as never)
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Terminal font family' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Terminal font size' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Keyboard shortcuts' }).querySelectorAll('input')).toHaveLength(6)
  })
})
