/** Structural client seams implemented by DSH's Workspace and Session plugins. */

export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface IWorkspaces {
  readonly list: ObservableSnapshot<{ readonly items: readonly WorkspaceView[] }>
  create(input: { path: string }): Promise<WorkspaceView>
}

export interface ISessions {
  readonly list: ObservableSnapshot<{ readonly current?: string }>
  open(id: string): void
}

export interface SessionClient {
  connectWorkspace(workspaceId: string): Promise<string>
  startSession(workspaceId?: string): void
}

export interface PropsRuntime<K extends string> { readonly [key: string]: unknown }
export interface PropsLocale<K extends string> { readonly [key: string]: unknown }
export interface PropsRenderSlots<K extends never> { readonly [key: string]: unknown }

export interface ClientSlotRegistry {
  inject(name: string, callback: () => () => void): void
  register(options: {
    name: string
    id: string
    order?: number
    label?: string | (() => string)
    inject?: () => Record<string, unknown>
  }, component: (props: Record<string, unknown>) => unknown): () => void
}

export interface LayoutClient {
  toggleSidebar(): void
  openDetails?(): void
  closeDetails?(): void
}

export interface Context {
  readonly slots: ClientSlotRegistry
  get<T>(service: string): T
}
