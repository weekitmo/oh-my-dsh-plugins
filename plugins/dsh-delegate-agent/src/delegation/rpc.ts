import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import {
  ADAPTER_IDS,
  type AdapterId,
  type DelegatePresetInput,
  type PermissionMode,
} from '../types.ts'
import { PresetConflictError, PresetLimitError, type DelegatePresetStore } from './preset-store.ts'
import {
  composePrompt,
  MAX_COMPOSED_PROMPT_LENGTH,
  MAX_FIXED_INSTRUCTIONS_LENGTH,
  MAX_PRESET_NAME_LENGTH,
} from './presets.ts'
import type { DelegationRuntime } from './runtime.ts'

interface WorkspaceView {
  readonly id: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceView[]
}

function ok<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function fail(code: string, message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringField(body: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = body?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function adapterId(value: unknown): AdapterId | undefined {
  return typeof value === 'string' && (ADAPTER_IDS as readonly string[]).includes(value) ? value as AdapterId : undefined
}

function permissionMode(value: unknown): PermissionMode | undefined {
  return value === 'read-only' || value === 'workspace-write' ? value : undefined
}

function workspaceForSession(registry: WorkspaceRegistryLike, sessionId: string): WorkspaceView | undefined {
  return registry.list().find(workspace => workspace.sessionIds.includes(sessionId))
}

function parsePresetInput(body: Record<string, unknown> | undefined): DelegatePresetInput | string {
  const name = stringField(body, 'name')
  const adapter = adapterId(body?.['adapterId'])
  const permission = permissionMode(body?.['permissionMode'])
  const fixedInstructions = stringField(body, 'fixedInstructions')
  if (name === undefined) return 'preset name must be a non-empty string'
  if (name.length > MAX_PRESET_NAME_LENGTH) return `preset name must not exceed ${String(MAX_PRESET_NAME_LENGTH)} characters`
  if (adapter === undefined) return 'adapterId must be pi, codex, or grok'
  if (permission === undefined) return 'permissionMode must be read-only or workspace-write'
  if (fixedInstructions === undefined) return 'fixedInstructions must be a non-empty string'
  if (fixedInstructions.length > MAX_FIXED_INSTRUCTIONS_LENGTH) {
    return `fixedInstructions must not exceed ${String(MAX_FIXED_INSTRUCTIONS_LENGTH)} characters`
  }
  const model = stringField(body, 'model')
  const provider = stringField(body, 'provider')
  const reasoning = stringField(body, 'reasoning')
  if (provider !== undefined && adapter !== 'pi') return 'provider is supported only by Pi presets'
  if (reasoning !== undefined && adapter === 'codex') return 'reasoning is not supported by Codex presets'
  return {
    name,
    adapterId: adapter,
    permissionMode: permission,
    fixedInstructions,
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}

function presetFailure(error: unknown): ConnectionRpcResult<never> {
  if (error instanceof PresetConflictError) return fail('delegate/preset-conflict', error.message)
  if (error instanceof PresetLimitError) return fail('delegate/preset-limit', error.message)
  return fail('delegate/preset-failed', error instanceof Error ? error.message : String(error))
}

export async function handleDelegateRpc(
  runtime: DelegationRuntime,
  presets: DelegatePresetStore,
  workspaces: WorkspaceRegistryLike,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ConnectionRpcResult<unknown>> {
  const body = object(payload)
  const sessionId = stringField(body, 'sessionId')
  if (endpoint === 'config.get') return ok(runtime.publicConfig())
  if (endpoint === 'adapters.list') return ok(await runtime.adapters(signal))
  if (sessionId === undefined) return fail('delegate/invalid-request', 'sessionId must be a non-empty string')

  if (endpoint === 'tasks.list') return ok(runtime.list(sessionId))
  if (endpoint === 'tasks.get') {
    const id = stringField(body, 'id')
    if (id === undefined) return fail('delegate/invalid-request', 'id must be a non-empty string')
    const task = runtime.get(id, sessionId)
    return task === undefined
      ? fail('delegate/not-found', 'delegated task was not found in this session')
      : ok(task)
  }
  if (endpoint === 'tasks.clear') {
    try {
      return ok({ removed: await runtime.clear(sessionId) })
    } catch (error) {
      return fail('delegate/clear-failed', error instanceof Error ? error.message : String(error))
    }
  }
  if (endpoint === 'tasks.start') {
    if (signal?.aborted === true) return fail('delegate/aborted', 'request was aborted before dispatch')
    const workspace = workspaceForSession(workspaces, sessionId)
    if (workspace === undefined) return fail('delegate/workspace-not-found', 'the current session is not attached to a workspace')
    const presetId = stringField(body, 'presetId')
    const preset = presetId === undefined ? undefined : presets.get(presetId, workspace.id)
    if (presetId !== undefined && preset === undefined) {
      return fail('delegate/preset-not-found', 'delegation preset was not found in this workspace')
    }
    const adapter = adapterId(body?.['adapterId']) ?? preset?.adapterId
    const directPrompt = stringField(body, 'prompt')
    const instruction = stringField(body, 'instruction')
    let prompt: string | undefined
    try {
      prompt = preset === undefined ? directPrompt : composePrompt(preset.fixedInstructions, instruction ?? directPrompt ?? '')
    } catch (error) {
      return fail('delegate/invalid-request', error instanceof Error ? error.message : String(error))
    }
    if (adapter === undefined) return fail('delegate/invalid-request', 'adapterId must be pi, codex, or grok')
    if (prompt === undefined) return fail('delegate/invalid-request', 'prompt must be a non-empty string')
    if (prompt.length > MAX_COMPOSED_PROMPT_LENGTH) {
      return fail('delegate/invalid-request', `composed prompt must not exceed ${String(MAX_COMPOSED_PROMPT_LENGTH)} characters`)
    }
    const explicitPermission = body?.['permissionMode'] === undefined ? undefined : permissionMode(body['permissionMode'])
    if (body?.['permissionMode'] !== undefined && explicitPermission === undefined) {
      return fail('delegate/invalid-request', 'permissionMode must be read-only or workspace-write')
    }
    const timeoutMs = body?.['timeoutMs']
    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      return fail('delegate/invalid-request', 'timeoutMs must be a positive safe integer')
    }
    const model = stringField(body, 'model') ?? preset?.model
    const provider = stringField(body, 'provider') ?? preset?.provider
    const reasoning = stringField(body, 'reasoning') ?? preset?.reasoning
    const permission = explicitPermission ?? preset?.permissionMode
    try {
      return ok(await runtime.start({
        ownerSessionId: sessionId,
        workspaceId: workspace.id,
        adapterId: adapter,
        prompt,
        cwd: workspace.path,
        ...(model === undefined ? {} : { model }),
        ...(provider === undefined ? {} : { provider }),
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(permission === undefined ? {} : { permissionMode: permission }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }))
    } catch (error) {
      return fail('delegate/start-failed', error instanceof Error ? error.message : String(error))
    }
  }
  if (endpoint === 'tasks.cancel') {
    const id = stringField(body, 'id')
    if (id === undefined) return fail('delegate/invalid-request', 'id must be a non-empty string')
    try {
      return ok({ result: await runtime.cancel(id, sessionId) })
    } catch (error) {
      return fail('delegate/not-found', error instanceof Error ? error.message : String(error))
    }
  }

  if (endpoint.startsWith('presets.')) {
    const workspace = workspaceForSession(workspaces, sessionId)
    if (workspace === undefined) return fail('delegate/workspace-not-found', 'the current session is not attached to a workspace')
    if (endpoint === 'presets.list') return ok(presets.list(workspace.id))
    if (endpoint === 'presets.create') {
      const input = parsePresetInput(body)
      if (typeof input === 'string') return fail('delegate/invalid-request', input)
      try {
        return ok(await presets.create(workspace.id, input))
      } catch (error) {
        return presetFailure(error)
      }
    }
    if (endpoint === 'presets.update') {
      const id = stringField(body, 'id')
      if (id === undefined) return fail('delegate/invalid-request', 'id must be a non-empty string')
      const input = parsePresetInput(body)
      if (typeof input === 'string') return fail('delegate/invalid-request', input)
      try {
        const updated = await presets.update(id, workspace.id, input)
        return updated === undefined
          ? fail('delegate/preset-not-found', 'delegation preset was not found in this workspace')
          : ok(updated)
      } catch (error) {
        return presetFailure(error)
      }
    }
    if (endpoint === 'presets.delete') {
      const id = stringField(body, 'id')
      if (id === undefined) return fail('delegate/invalid-request', 'id must be a non-empty string')
      try {
        return await presets.delete(id, workspace.id)
          ? ok({ deleted: true })
          : fail('delegate/preset-not-found', 'delegation preset was not found in this workspace')
      } catch (error) {
        return presetFailure(error)
      }
    }
  }
  return fail('delegate/not-found', `unknown endpoint ${JSON.stringify(endpoint)}`)
}
