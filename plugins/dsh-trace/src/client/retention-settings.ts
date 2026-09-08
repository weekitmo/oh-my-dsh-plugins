import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

export const RETENTION_SETTINGS_NAMESPACE = 'dsh-trace'
export const DEFAULT_RETENTION_HOURS = 24
export const RETENTION_PRESETS = [24, 72, 168] as const
export const MAX_RETENTION_HOURS = Math.floor(Number.MAX_SAFE_INTEGER / (60 * 60 * 1000))

export interface RetentionSettings {
  readonly retentionHours: number
}

export type RetentionUnit = 'hours' | 'days'

export function decodeRetentionSettings(value: unknown): RetentionSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const retentionHours = (value as Record<string, unknown>)['retentionHours']
  if (!Number.isSafeInteger(retentionHours) || (retentionHours as number) < 1
    || (retentionHours as number) > MAX_RETENTION_HOURS) return undefined
  return { retentionHours: retentionHours as number }
}

export function retentionInputToHours(value: string, unit: RetentionUnit): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined
  const numeric = Number(value)
  const hours = unit === 'days' ? numeric * 24 : numeric
  return Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_RETENTION_HOURS ? hours : undefined
}

export function retentionSettingsScope(
  settingsScope: { bind<T>(spec: { namespace: string; decode?: (value: unknown) => T | undefined }): SettingsScope<T> },
): SettingsScope<RetentionSettings> {
  return settingsScope.bind({
    namespace: RETENTION_SETTINGS_NAMESPACE,
    decode: decodeRetentionSettings,
  })
}
