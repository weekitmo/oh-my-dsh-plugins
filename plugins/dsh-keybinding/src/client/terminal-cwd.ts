/** Resolve a new terminal's initial directory from the active DSH Workspace. */
import type { ISessions, IWorkspaces } from './types.ts'

/**
 * Find the Workspace path containing the current Session.
 * @param workspaces - DSH Workspace snapshot source.
 * @param sessions - DSH Session snapshot source.
 * @returns The active Workspace path, or `undefined` without a Workspace Session.
 */
export function currentWorkspacePath(workspaces: IWorkspaces, sessions: ISessions): string | undefined {
  const current = sessions.list.getSnapshot().current
  if (current === undefined) return undefined
  return workspaces.list.getSnapshot().items.find(workspace => workspace.sessionIds.includes(current))?.path
}
