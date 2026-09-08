import { describe, expect, it, vi } from 'vitest'
import { currentWorkspacePath } from '../src/client/terminal-cwd.ts'
import type { ISessions, IWorkspaces } from '../src/client/types.ts'

const workspaces: IWorkspaces = {
  list: {
    getSnapshot: () => ({ items: [
      { workspaceId: 'one', path: '/work/one', title: 'one', sessionIds: ['session-one'] },
      { workspaceId: 'two', path: '/work/two', title: 'two', sessionIds: ['session-two'] },
    ] }),
    subscribe: vi.fn(),
  },
  create: vi.fn(),
}

describe('terminal workspace cwd', () => {
  it('uses the Workspace containing the current Session', () => {
    expect(currentWorkspacePath(workspaces, sessions('session-two'))).toBe('/work/two')
  })

  it('leaves cwd unresolved for a Session outside registered Workspaces', () => {
    expect(currentWorkspacePath(workspaces, sessions('ungrouped'))).toBeUndefined()
    expect(currentWorkspacePath(workspaces, sessions())).toBeUndefined()
  })
})

function sessions(current?: string): ISessions {
  return {
    list: {
      getSnapshot: () => current === undefined ? {} : { current },
      subscribe: vi.fn(),
    },
    open: vi.fn(),
  }
}
