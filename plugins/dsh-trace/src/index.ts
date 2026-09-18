import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installLlmFetchCapture } from './trace/capture.ts'
import { registerTraceRoutes } from './trace/routes.ts'
import { TraceSqliteStore } from './trace/store.ts'

// The target Web profile provides this Host service, but its package is not
// published at the plugin's pinned DSH version. Keep the consumed face local.
interface TraceHostContext extends Context {
  readonly workspaceRegistry: {
    list(): Array<{ readonly id: string; readonly sessionIds: readonly string[] }>
  }
}

export const name = '@weekit/dsh-trace'
export const storageNamespace = 'dsh-trace'
export const inject = ['connection', 'llm', 'workspaceRegistry']

const HOUR_MS = 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = HOUR_MS
export const MAX_RETENTION_HOURS = Math.floor(Number.MAX_SAFE_INTEGER / HOUR_MS)

export interface Config {
  readonly retentionHours?: number
  readonly maxRequestBodyBytes?: number
  readonly maxResponseBodyBytes?: number
  readonly maxRecords?: number
  readonly maxStorageBytes?: number
}

export const Config: z<Config> = z.object({
  retentionHours: z.number().step(1).min(1).max(MAX_RETENTION_HOURS).default(24),
  maxRequestBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1024 * 1024),
  maxResponseBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4 * 1024 * 1024),
  maxRecords: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10_000),
  maxStorageBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128 * 1024 * 1024),
})

interface ResolvedConfig {
  readonly retentionHours: number
  readonly retentionMs: number
  readonly maxRequestBodyBytes: number
  readonly maxResponseBodyBytes: number
  readonly maxRecords: number
  readonly maxStorageBytes: number
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`dsh-trace: ${field} must be a positive safe integer`)
  }
  return resolved
}

function resolveConfig(config: Config): ResolvedConfig {
  const retentionHours = positiveInteger(config.retentionHours, 24, 'retentionHours')
  if (retentionHours > MAX_RETENTION_HOURS) {
    throw new Error(`dsh-trace: retentionHours must be no greater than ${String(MAX_RETENTION_HOURS)}`)
  }
  return {
    retentionHours,
    retentionMs: retentionHours * HOUR_MS,
    maxRequestBodyBytes: positiveInteger(config.maxRequestBodyBytes, 1024 * 1024, 'maxRequestBodyBytes'),
    maxResponseBodyBytes: positiveInteger(config.maxResponseBodyBytes, 4 * 1024 * 1024, 'maxResponseBodyBytes'),
    maxRecords: positiveInteger(config.maxRecords, 10_000, 'maxRecords'),
    maxStorageBytes: positiveInteger(config.maxStorageBytes, 128 * 1024 * 1024, 'maxStorageBytes'),
  }
}

export function apply(ctx: TraceHostContext, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger(name)
  let retention = (): number => resolved.retentionHours
  let activeStore: TraceSqliteStore | undefined

  const workspaceIdForSession = (sessionId: string): string | undefined => (
    ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))?.id
  )

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, storageNamespace, z.object({
      retentionHours: z.number().step(1).min(1).max(MAX_RETENTION_HOURS).default(24),
    }), { retentionHours: resolved.retentionHours }, {
      setSource: source => { retention = () => source().retentionHours },
      onChange: () => {
        const store = activeStore
        if (store === undefined) return
        void store.setRetentionMs(retention() * HOUR_MS).catch((error: unknown) => {
          logger.warn('request trace retention update failed: %s', error)
        })
      },
    })
  })

  ctx.effect(async () => {
    const traceDirectory = join(resolveDshHome(), storageNamespace)
    const store = new TraceSqliteStore({
      path: join(traceDirectory, 'requests.sqlite'),
      legacyJsonlPath: join(traceDirectory, 'requests.jsonl'),
      retentionMs: retention() * HOUR_MS,
      maxRecords: resolved.maxRecords,
      maxStorageBytes: resolved.maxStorageBytes,
      resolveWorkspaceId: workspaceIdForSession,
    })
    await store.initialize()
    activeStore = store
    const cleanupTimer = setInterval(() => {
      void store.cleanup().catch((error: unknown) => {
        logger.warn('request trace cleanup failed: %s', error)
      })
    }, CLEANUP_INTERVAL_MS)
    cleanupTimer.unref()

    const capture = installLlmFetchCapture(store, {
      maxRequestBodyBytes: resolved.maxRequestBodyBytes,
      maxResponseBodyBytes: resolved.maxResponseBodyBytes,
      onError: error => logger.warn('request trace persistence failed: %s', error),
    })
    // DSH swallows asynchronous effect failures, so a missing route would
    // otherwise leave the browser half with transport failures and no log line.
    let removeRoutes: (() => Promise<void>) | undefined
    try {
      removeRoutes = registerTraceRoutes(ctx, store, workspaceIdForSession)
    } catch (error) {
      logger.error('dsh-trace: request-trace route registration failed: %s', error)
      throw error
    }
    const removeLlmListener = ctx.on('llm/stream', (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk> => {
      if (options.sessionId === undefined) return next()
      const sessionId = String(options.sessionId)
      const workspaceId = workspaceIdForSession(sessionId)
      return capture.wrapStream({
        provider: options.provider,
        model: options.model,
        ...workspaceId === undefined ? {} : { workspaceId },
        sessionId,
        ...options.purpose === undefined ? {} : { purpose: options.purpose },
      }, next)
    }, { global: true, prepend: true })

    return async () => {
      activeStore = undefined
      clearInterval(cleanupTimer)
      await removeRoutes?.()
      await removeLlmListener()
      await capture.stop()
      await store.close()
    }
  }, 'dsh-trace lifecycle')
}
