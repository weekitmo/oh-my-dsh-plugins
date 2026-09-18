// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceHints, workspaceHintLabels } from '../src/client/workspace-hints.tsx'

function addSidebarTree(items: readonly { name: string; group?: boolean }[]): HTMLElement[] {
  const root = document.createElement('div')
  root.id = 'root'
  const tree = document.createElement('div')
  tree.setAttribute('role', 'tree')
  tree.getBoundingClientRect = () => rect(12, 80, 256, 700)
  const rows = items.map((item, index) => {
    const row = document.createElement('div')
    row.setAttribute('role', 'treeitem')
    if (item.group) row.setAttribute('aria-expanded', 'true')
    else row.setAttribute('aria-selected', 'false')
    row.textContent = item.name
    row.getBoundingClientRect = () => rect(12, 100 + index * 34, 256, 34)
    tree.append(row)
    return row
  })
  root.append(tree)
  document.body.append(root)
  return rows
}

/**
 * Testing Library's automatic cleanup only registers when vitest exposes globals
 * (this repo does not), so unmount the React tree explicitly before wiping the
 * body. Wiping first detaches the portal container and the later React removal
 * throws `NotFoundError: The node to be removed is not a child of this node`,
 * which made the release gate flaky under CI load.
 */
afterEach(() => { cleanup(); document.body.replaceChildren() })

describe('workspace and session hints', () => {
  it('assigns home-row labels and expands to fixed-width labels', () => {
    expect(workspaceHintLabels(4)).toEqual(['A', 'S', 'D', 'F'])
    const labels = workspaceHintLabels(27)
    expect(labels).toHaveLength(27)
    expect(new Set(labels).size).toBe(27)
    expect(labels.every(label => label.length === 2)).toBe(true)
  })

  it('waits for a sidebar tree mounted after hint activation', async () => {
    render(<WorkspaceHints activation={1} />)
    addSidebarTree([{ name: 'alpha', group: true }])

    expect(await screen.findByRole('button', { name: 'alpha: A' })).toBeTruthy()
  })

  it('selects a visible session row with its letter', async () => {
    const [, session] = addSidebarTree([{ name: 'alpha', group: true }, { name: 'session one' }])
    const sessionClick = vi.fn()
    session!.addEventListener('click', sessionClick)
    render(<WorkspaceHints activation={1} />)
    const overlay = await screen.findByLabelText('Workspace and session hints')

    fireEvent.keyDown(document.body, { key: 's' })

    expect(sessionClick).toHaveBeenCalledTimes(1)
    expect(overlay.isConnected).toBe(false)
  })

  it('selects a group when its letter button is clicked', async () => {
    const [group] = addSidebarTree([{ name: 'alpha', group: true }, { name: 'session one' }])
    const groupClick = vi.fn()
    group!.addEventListener('click', groupClick)
    render(<WorkspaceHints activation={1} />)

    fireEvent.click(await screen.findByRole('button', { name: 'alpha: A' }))

    expect(groupClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Workspace and session hints')).toBeNull()
  })

  it('dismisses hints with Escape without selecting', async () => {
    const [group] = addSidebarTree([{ name: 'alpha', group: true }])
    const groupClick = vi.fn()
    group!.addEventListener('click', groupClick)
    render(<WorkspaceHints activation={1} />)
    const overlay = await screen.findByLabelText('Workspace and session hints')

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(groupClick).not.toHaveBeenCalled()
    expect(overlay.isConnected).toBe(false)
  })
})

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x, y, width, height, top: y, right: x + width, bottom: y + height, left: x,
    toJSON: () => ({}),
  }
}
