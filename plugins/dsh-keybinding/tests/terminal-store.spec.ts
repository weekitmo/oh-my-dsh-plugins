import { describe, expect, it } from 'vitest'
import { createTerminalUiStore } from '../src/client/terminal-store.ts'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('terminal UI store', () => {
  it('persists bounded font and height preferences', () => {
    const target = storage()
    const store = createTerminalUiStore(target)
    store.setFontFamily('MesloLGS NF')
    store.setFontSize(40)
    store.setHeight(50)

    expect(store.getSnapshot()).toMatchObject({ fontFamily: 'MesloLGS NF', fontSize: 32, height: 140 })
    expect(createTerminalUiStore(target).getSnapshot()).toMatchObject({ fontFamily: 'MesloLGS NF', fontSize: 32, height: 140, open: false })
  })

  it('replaces terminal identity for a new shell', () => {
    const store = createTerminalUiStore(storage())
    const first = store.getSnapshot().terminalId
    store.newTerminal()
    expect(store.getSnapshot()).toMatchObject({ open: true })
    expect(store.getSnapshot().terminalId).not.toBe(first)
  })
})
