import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { API_CHANNEL, delegateRpcAddress, type DelegateRpcEndpoint } from '../rpc-contract.ts'
import type {
  AdapterDescriptor, AdapterId, DelegatePreset, DelegatePresetInput, DelegateTask, PermissionMode, PublicConfig, TaskList,
} from '../types.ts'

export type StartTaskInput = {
  readonly adapterId: AdapterId
  readonly prompt: string
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly permissionMode: PermissionMode
} | {
  readonly presetId: string
  readonly instruction: string
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly permissionMode?: PermissionMode
}

export interface DelegateClient {
  config(signal?: AbortSignal): Promise<PublicConfig>
  adapters(signal?: AbortSignal): Promise<readonly AdapterDescriptor[]>
  list(sessionId: string, signal?: AbortSignal): Promise<TaskList>
  get(sessionId: string, id: string, signal?: AbortSignal): Promise<DelegateTask>
  start(sessionId: string, input: StartTaskInput, signal?: AbortSignal): Promise<DelegateTask>
  cancel(sessionId: string, id: string, signal?: AbortSignal): Promise<'requested' | 'already-finished'>
  clearHistory(sessionId: string, signal?: AbortSignal): Promise<number>
  presets(sessionId: string, signal?: AbortSignal): Promise<readonly DelegatePreset[]>
  createPreset(sessionId: string, input: DelegatePresetInput, signal?: AbortSignal): Promise<DelegatePreset>
  updatePreset(sessionId: string, id: string, input: DelegatePresetInput, signal?: AbortSignal): Promise<DelegatePreset>
  deletePreset(sessionId: string, id: string, signal?: AbortSignal): Promise<void>
}

function rpcValue(result: { ok: true; value: unknown } | { ok: false; error: { message: string } }): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('delegate host returned invalid data')
  return value as Record<string, unknown>
}

function parseTask(value: unknown): DelegateTask {
  const row = object(value)
  if (typeof row['id'] !== 'string' || typeof row['adapterId'] !== 'string' || typeof row['status'] !== 'string') {
    throw new Error('delegate host returned an invalid task')
  }
  return value as DelegateTask
}

function parsePreset(value: unknown): DelegatePreset {
  const row = object(value)
  if (typeof row['id'] !== 'string' || typeof row['name'] !== 'string' || typeof row['adapterId'] !== 'string') {
    throw new Error('delegate host returned an invalid preset')
  }
  return value as DelegatePreset
}

export function createDelegateClient(ctx: Context): DelegateClient {
  const connection = ctx.connection as unknown as ConnectionHandle
  const call = async (endpoint: DelegateRpcEndpoint, payload: unknown, signal?: AbortSignal): Promise<unknown> => (
    rpcValue(await connection.rpc.call(API_CHANNEL, delegateRpcAddress(endpoint), payload, signal))
  )
  return {
    async config(signal) {
      return object(await call('config.get', {}, signal)) as unknown as PublicConfig
    },
    async adapters(signal) {
      const value = await call('adapters.list', {}, signal)
      if (!Array.isArray(value)) throw new Error('delegate host returned an invalid adapter list')
      return value as AdapterDescriptor[]
    },
    async list(sessionId, signal) {
      const value = object(await call('tasks.list', { sessionId }, signal))
      if (!Array.isArray(value['tasks']) || typeof value['activeCount'] !== 'number') {
        throw new Error('delegate host returned an invalid task list')
      }
      return { tasks: value['tasks'].map(parseTask), activeCount: value['activeCount'] }
    },
    async get(sessionId, id, signal) {
      return parseTask(await call('tasks.get', { sessionId, id }, signal))
    },
    async start(sessionId, input, signal) {
      return parseTask(await call('tasks.start', { sessionId, ...input }, signal))
    },
    async cancel(sessionId, id, signal) {
      const value = object(await call('tasks.cancel', { sessionId, id }, signal))
      return value['result'] === 'already-finished' ? 'already-finished' : 'requested'
    },
    async clearHistory(sessionId, signal) {
      const value = object(await call('tasks.clear', { sessionId }, signal))
      if (typeof value['removed'] !== 'number') throw new Error('delegate host returned an invalid clear result')
      return value['removed']
    },
    async presets(sessionId, signal) {
      const value = await call('presets.list', { sessionId }, signal)
      if (!Array.isArray(value)) throw new Error('delegate host returned an invalid preset list')
      return value.map(parsePreset)
    },
    async createPreset(sessionId, input, signal) {
      return parsePreset(await call('presets.create', { sessionId, ...input }, signal))
    },
    async updatePreset(sessionId, id, input, signal) {
      return parsePreset(await call('presets.update', { sessionId, id, ...input }, signal))
    },
    async deletePreset(sessionId, id, signal) {
      await call('presets.delete', { sessionId, id }, signal)
    },
  }
}
