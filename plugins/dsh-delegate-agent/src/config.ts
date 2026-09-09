import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { AdapterId, PermissionMode } from './types.ts'

export interface AdapterConfig {
  readonly command?: string
  readonly enabled?: boolean
  readonly env?: Readonly<Record<string, string>>
}

export interface Config {
  readonly dataDir?: string
  readonly allowedWorkspaceRoots?: readonly string[]
  readonly maxConcurrentRuns?: number
  readonly defaultTimeoutMs?: number
  readonly terminateGraceMs?: number
  readonly maxLogBytes?: number
  readonly maxEventCount?: number
  readonly retentionDays?: number
  readonly defaultPermissionMode?: PermissionMode
  readonly adapters?: Partial<Record<AdapterId, AdapterConfig>>
}

const adapterSchema = z.object({
  command: z.string(),
  enabled: z.boolean(),
  env: z.dict(z.string()),
})

export const Config = z.object({
  dataDir: z.string(),
  allowedWorkspaceRoots: z.array(z.string()),
  maxConcurrentRuns: z.number().step(1).min(1),
  defaultTimeoutMs: z.number().step(1).min(1),
  terminateGraceMs: z.number().step(1).min(1),
  maxLogBytes: z.number().step(1).min(1),
  maxEventCount: z.number().step(1).min(1),
  retentionDays: z.number().step(1).min(1),
  defaultPermissionMode: z.union(['read-only', 'workspace-write']),
  adapters: z.object({ pi: adapterSchema, codex: adapterSchema, grok: adapterSchema }),
})

export interface ResolvedAdapterConfig {
  readonly command: string
  readonly enabled: boolean
  readonly env: Readonly<Record<string, string>>
}

export interface ResolvedConfig {
  readonly dataDir: string
  readonly allowedWorkspaceRoots: readonly string[]
  readonly maxConcurrentRuns: number
  readonly defaultTimeoutMs: number
  readonly terminateGraceMs: number
  readonly maxLogBytes: number
  readonly maxEventCount: number
  readonly retentionDays: number
  readonly defaultPermissionMode: PermissionMode
  readonly adapters: Readonly<Record<AdapterId, ResolvedAdapterConfig>>
}

const commands: Readonly<Record<AdapterId, string>> = { pi: 'pi', codex: 'codex', grok: 'grok' }

function expandPath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2))
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)
}

function positive(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`dsh-delegate-agent: ${name} must be a positive safe integer`)
  return value
}

export function resolveConfig(input: Config = {}): ResolvedConfig {
  const defaultDataRoot = process.env['DSH_HOME'] ?? resolve(homedir(), '.dsh')
  const adapters = Object.fromEntries((Object.keys(commands) as AdapterId[]).map((id) => {
    const configured = input.adapters?.[id]
    return [id, {
      command: configured?.command ?? commands[id],
      enabled: configured?.enabled ?? true,
      env: { ...(configured?.env ?? {}) },
    }]
  })) as Record<AdapterId, ResolvedAdapterConfig>
  return {
    dataDir: expandPath(input.dataDir ?? resolve(defaultDataRoot, 'delegate-agent')),
    allowedWorkspaceRoots: (input.allowedWorkspaceRoots ?? []).map(expandPath),
    maxConcurrentRuns: positive('maxConcurrentRuns', input.maxConcurrentRuns ?? 3),
    defaultTimeoutMs: positive('defaultTimeoutMs', input.defaultTimeoutMs ?? 30 * 60_000),
    terminateGraceMs: positive('terminateGraceMs', input.terminateGraceMs ?? 3_000),
    maxLogBytes: positive('maxLogBytes', input.maxLogBytes ?? 2 * 1024 * 1024),
    maxEventCount: positive('maxEventCount', input.maxEventCount ?? 2_000),
    retentionDays: positive('retentionDays', input.retentionDays ?? 30),
    defaultPermissionMode: input.defaultPermissionMode ?? 'read-only',
    adapters,
  }
}
