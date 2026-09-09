import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveConfig, Config, type Config as DelegateConfig } from './config.ts'
import { DelegatePresetStore } from './delegation/preset-store.ts'
import { handleDelegateRpc, type WorkspaceRegistryLike } from './delegation/rpc.ts'
import { DelegationRuntime, type SubprocessRuntimeLike } from './delegation/runtime.ts'
import { DelegateTaskStore } from './delegation/store.ts'

export { Config }
export type { DelegateConfig }
export * from './types.ts'
export { buildInvocation, commandPreview } from './delegation/adapters.ts'
export { ProtocolParser } from './delegation/protocol.ts'
export { DelegatePresetStore } from './delegation/preset-store.ts'
export { composePrompt } from './delegation/presets.ts'
export { DelegationRuntime } from './delegation/runtime.ts'
export { DelegateTaskStore } from './delegation/store.ts'

export const name = '@weekit/dsh-delegate-agent'
export const inject = ['connection', 'subprocess', 'workspaceRegistry']

type HostContext = Context & {
  readonly subprocess: SubprocessRuntimeLike
  readonly workspaceRegistry: WorkspaceRegistryLike
}

export function apply(ctx: HostContext, config: DelegateConfig = {}): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger(name)
  ctx.effect(async () => {
    const store = new DelegateTaskStore(resolved.dataDir, resolved.retentionDays, error => logger.warn(error))
    const presets = new DelegatePresetStore(resolved.dataDir)
    await Promise.all([store.initialize(), presets.initialize()])
    const runtime = new DelegationRuntime(ctx.subprocess, store, resolved, error => logger.warn(error))
    const removeRpc = ctx.connection.rpc.handle('/dsh-delegate-agent', (endpoint, payload, signal) => (
      handleDelegateRpc(runtime, presets, ctx.workspaceRegistry, endpoint, payload, signal)
    ))
    return async () => {
      await removeRpc()
      await runtime.dispose()
      await Promise.all([store.close(), presets.close()])
    }
  }, 'dsh-delegate-agent lifecycle')
}
