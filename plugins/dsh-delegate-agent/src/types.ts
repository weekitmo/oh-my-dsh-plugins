export const ADAPTER_IDS = ['pi', 'codex', 'grok'] as const
export type AdapterId = typeof ADAPTER_IDS[number]
export type PermissionMode = 'read-only' | 'workspace-write'
export type TaskStatus = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'killed' | 'timed-out' | 'interrupted'
export type TerminalTaskStatus = Extract<TaskStatus, 'completed' | 'failed' | 'killed' | 'timed-out' | 'interrupted'>

export interface AdapterDescriptor {
  readonly id: AdapterId
  readonly label: string
  readonly command: string
  readonly enabled: boolean
  readonly available: boolean
  readonly executable?: string
  readonly error?: string
  readonly permissions: readonly PermissionMode[]
  readonly supportsModel: boolean
  readonly supportsProvider: boolean
  readonly supportsReasoning: boolean
}

export interface DelegateEvent {
  readonly sequence: number
  readonly at: number
  readonly type: 'assistant' | 'tool' | 'usage' | 'session' | 'diagnostic'
  readonly text?: string
  readonly name?: string
  readonly data?: Readonly<Record<string, unknown>>
}

export interface DelegatePresetInput {
  readonly name: string
  readonly adapterId: AdapterId
  readonly permissionMode: PermissionMode
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly fixedInstructions: string
}

export interface DelegatePreset extends DelegatePresetInput {
  readonly id: string
  readonly workspaceId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface DelegateTask {
  readonly id: string
  readonly ownerSessionId: string
  readonly workspaceId: string
  readonly adapterId: AdapterId
  readonly prompt: string
  readonly cwd: string
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly permissionMode: PermissionMode
  readonly status: TaskStatus
  readonly command: readonly string[]
  readonly pid?: number
  readonly createdAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly updatedAt: number
  readonly stdout: string
  readonly stderr: string
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly events: readonly DelegateEvent[]
  readonly finalText?: string
  readonly externalSessionId?: string
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly timedOut: boolean
  readonly diagnostic?: string
}

export interface StartRequest {
  readonly ownerSessionId: string
  readonly workspaceId: string
  readonly adapterId: AdapterId
  readonly prompt: string
  readonly cwd: string
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly permissionMode?: PermissionMode
  readonly timeoutMs?: number
}

export interface PublicConfig {
  readonly maxConcurrentRuns: number
  readonly defaultTimeoutMs: number
  readonly maxLogBytes: number
  readonly retentionDays: number
  readonly defaultPermissionMode: PermissionMode
}

export interface TaskList {
  readonly tasks: readonly DelegateTask[]
  readonly activeCount: number
}
