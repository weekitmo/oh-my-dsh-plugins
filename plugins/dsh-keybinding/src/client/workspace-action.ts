/** Workspace registration, navigation, and sidebar reveal for terminal actions. */
import type { WorkspaceAction } from '../core/protocol.ts'
import type { TerminalClientContext } from './terminal-panel.tsx'

const WORKSPACE_ROWS = '#root [role="tree"] [role="treeitem"][aria-expanded]'
const SELECTED_SESSION = '#root [role="tree"] [role="treeitem"][aria-selected="true"]'

/**
 * Register a terminal path, switch when needed, and reveal its sidebar rows.
 * @param context - DSH Workspace and Session services.
 * @param action - Parsed private terminal action.
 */
export async function runWorkspaceAction(context: TerminalClientContext, action: WorkspaceAction): Promise<void> {
  const workspace = await context.workspaces.create({ path: action.cwd })
  const current = context.sessions.list.getSnapshot().current
  const targetIsCurrent = current !== undefined && workspace.sessionIds.includes(current)

  if (!targetIsCurrent) context.uiWorkspace.startSession(workspace.workspaceId)

  await revealWorkspace(context, workspace.workspaceId)
}

async function revealWorkspace(context: TerminalClientContext, workspaceId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const snapshot = context.workspaces.list.getSnapshot()
    const workspaceIndex = snapshot.items.findIndex(item => item.workspaceId === workspaceId)
    const workspace = snapshot.items[workspaceIndex]
    const rows = document.querySelectorAll<HTMLElement>(WORKSPACE_ROWS)
    const workspaceRow = workspaceIndex < 0 ? undefined : rows[workspaceIndex]

    if (workspaceRow !== undefined) {
      workspaceRow.scrollIntoView({ block: 'nearest' })
      if (workspaceRow.getAttribute('aria-expanded') === 'false') workspaceRow.click()
    }

    const current = context.sessions.list.getSnapshot().current
    const targetIsCurrent = current !== undefined && workspace?.sessionIds.includes(current) === true
    if (workspaceRow !== undefined && targetIsCurrent) {
      const tree = workspaceRow.closest<HTMLElement>('[role="tree"]')
      let section = workspaceRow
      while (tree !== null && section.parentElement !== null && section.parentElement !== tree) section = section.parentElement
      const selectedSession = section.querySelector<HTMLElement>(SELECTED_SESSION)
      if (selectedSession !== null) {
        selectedSession.scrollIntoView({ block: 'nearest' })
        return
      }
    }
    await nextFrame()
  }
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}
