// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWorkspaceAction } from '../src/client/workspace-action.ts'
import type { TerminalClientContext } from '../src/client/terminal-panel.tsx'
import type { WorkspaceView } from '../src/client/types.ts'

function mountSidebar(workspaces: readonly WorkspaceView[], selectedWorkspaceId: string, scrolled: string[] = []) {
  const root = document.createElement('div')
  root.id = 'root'
  const tree = document.createElement('div')
  tree.setAttribute('role', 'tree')
  for (const workspace of workspaces) {
    const section = document.createElement('div')
    const row = document.createElement('div')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-expanded', 'true')
    row.textContent = workspace.title
    row.scrollIntoView = () => { scrolled.push(`workspace:${workspace.workspaceId}`) }
    section.append(row)
    if (workspace.workspaceId === selectedWorkspaceId) {
      const session = document.createElement('div')
      session.setAttribute('role', 'treeitem')
      session.setAttribute('aria-selected', 'true')
      session.scrollIntoView = () => { scrolled.push(`session:${workspace.workspaceId}`) }
      section.append(session)
    }
    tree.append(section)
  }
  root.append(tree)
  document.body.append(root)
  return scrolled
}

function context(workspaces: WorkspaceView[], current: { value?: string }, startSession = vi.fn()): TerminalClientContext {
  return {
    workspaces: {
      list: { getSnapshot: () => ({ items: workspaces }), subscribe: vi.fn() },
      create: vi.fn(async ({ path }) => workspaces.find(workspace => workspace.path === path)!),
    },
    sessions: {
      list: { getSnapshot: () => current.value === undefined ? {} : { current: current.value }, subscribe: vi.fn() },
      open: vi.fn(),
    },
    uiWorkspace: { connectWorkspace: vi.fn(), startSession },
  }
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('terminal workspace action', () => {
  it('keeps the current workspace session and reveals both rows', async () => {
    const target = workspace('target', '/target', ['session-target'])
    const current = { value: 'session-target' }
    const startSession = vi.fn()
    const client = context([target], current, startSession)
    const scrolled = mountSidebar([target], target.workspaceId)

    await runWorkspaceAction(client, { action: 'add', cwd: target.path })

    expect(startSession).not.toHaveBeenCalled()
    expect(scrolled).toEqual(['workspace:target', 'session:target'])
  })

  it('starts a session in an existing non-current workspace and reveals it', async () => {
    const first = workspace('first', '/first', ['session-first'])
    const target = workspace('target', '/target', [])
    const current = { value: 'session-first' }
    const scrolled: string[] = []
    const startSession = vi.fn((workspaceId: string) => {
      expect(workspaceId).toBe('target')
      target.sessionIds = ['session-target']
      current.value = 'session-target'
      mountSidebar([first, target], target.workspaceId, scrolled)
    })
    const client = context([first, target], current, startSession)

    await runWorkspaceAction(client, { action: 'open', cwd: target.path })

    expect(startSession).toHaveBeenCalledWith('target')
    expect(scrolled).toEqual(['workspace:target', 'session:target'])
  })
})

function workspace(workspaceId: string, path: string, sessionIds: string[]): WorkspaceView & { sessionIds: string[] } {
  return { workspaceId, path, title: workspaceId, sessionIds }
}
