import type { AttentionEntry, NotificationReason, NotificationSettings } from '../contract.ts'
import { reasonEnabled } from './decision.ts'

export const DEFAULT_MAX_BODY_CHARS = 400
export const MIN_MAX_BODY_CHARS = 100
export const MAX_MAX_BODY_CHARS = 2000

export function validMaxBodyChars(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_MAX_BODY_CHARS && value <= MAX_MAX_BODY_CHARS
}

export function defaultNotificationSettings(): NotificationSettings {
  return {
    enabled: true,
    systemNotifications: true,
    titleNotifications: true,
    runningTitleIndicator: true,
    idleTitleAnimation: true,
    idleFaviconIndicator: false,
    sidebarIndicators: true,
    titleAnimation: 'marquee',
    maxBodyChars: DEFAULT_MAX_BODY_CHARS,
    backgroundOnly: false,
    notifyCompleted: true,
    notifyError: true,
    notifyAborted: true,
    notifyBlocked: true,
    notifyMaxTokens: true,
  }
}

export interface AttentionState {
  readonly bySession: Record<string, AttentionEntry>
}


function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Merge persisted browser data with current defaults before the UI consumes it. */
export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const defaults = defaultNotificationSettings()
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const animation = source.titleAnimation === 'blink' || source.titleAnimation === 'marquee'
    ? source.titleAnimation
    : defaults.titleAnimation
  return {
    enabled: booleanOr(source.enabled, defaults.enabled),
    systemNotifications: booleanOr(source.systemNotifications, defaults.systemNotifications),
    titleNotifications: booleanOr(source.titleNotifications, defaults.titleNotifications),
    runningTitleIndicator: booleanOr(source.runningTitleIndicator, defaults.runningTitleIndicator),
    idleTitleAnimation: booleanOr(source.idleTitleAnimation, defaults.idleTitleAnimation),
    idleFaviconIndicator: booleanOr(source.idleFaviconIndicator, defaults.idleFaviconIndicator),
    sidebarIndicators: booleanOr(source.sidebarIndicators, defaults.sidebarIndicators),
    titleAnimation: animation,
    maxBodyChars: validMaxBodyChars(source.maxBodyChars) ? source.maxBodyChars : defaults.maxBodyChars,
    backgroundOnly: booleanOr(source.backgroundOnly, defaults.backgroundOnly),
    notifyCompleted: booleanOr(source.notifyCompleted, defaults.notifyCompleted),
    notifyError: booleanOr(source.notifyError, defaults.notifyError),
    notifyAborted: booleanOr(source.notifyAborted, defaults.notifyAborted),
    notifyBlocked: booleanOr(source.notifyBlocked, defaults.notifyBlocked),
    notifyMaxTokens: booleanOr(source.notifyMaxTokens, defaults.notifyMaxTokens),
  }
}

/** Remove unread results that the current settings no longer allow to surface. */
export function filterAttentionBySettings(
  state: AttentionState,
  settings: NotificationSettings,
): AttentionState {
  const allowed = settings.enabled
    ? Object.fromEntries(Object.entries(state.bySession).filter(([, entry]) => reasonEnabled(settings, entry.reason)))
    : {}
  return Object.keys(allowed).length === Object.keys(state.bySession).length ? state : { bySession: allowed }
}

export function putAttention(state: AttentionState, entry: AttentionEntry): AttentionState {
  return { bySession: { ...state.bySession, [entry.sessionId]: entry } }
}

export function clearAttention(state: AttentionState, sessionId: string): AttentionState {
  if (state.bySession[sessionId] === undefined) return state
  const next = { ...state.bySession }
  delete next[sessionId]
  return { bySession: next }
}

export function retainAttention(state: AttentionState, sessionIds: ReadonlySet<string>): AttentionState {
  const next = Object.fromEntries(Object.entries(state.bySession).filter(([id]) => sessionIds.has(id)))
  return Object.keys(next).length === Object.keys(state.bySession).length ? state : { bySession: next }
}

export function attentionEntries(state: AttentionState): AttentionEntry[] {
  return Object.values(state.bySession).sort((a, b) => a.createdAt - b.createdAt)
}

export interface RunningSessionSummary {
  readonly id: string
  readonly parentId?: string
  readonly origin?: 'subagent'
  readonly running: boolean
}

export function runningConversationCount(
  ids: readonly string[],
  byId: Readonly<Record<string, RunningSessionSummary | undefined>>,
): number {
  const active = new Set<string>()
  for (const id of ids) {
    const initial = byId[id]
    if (initial?.running !== true) continue
    let current: RunningSessionSummary = initial
    const visited = new Set<string>()
    while (current.origin === 'subagent' && current.parentId !== undefined && !visited.has(current.id)) {
      visited.add(current.id)
      const parent: RunningSessionSummary | undefined = byId[current.parentId]
      if (parent === undefined) break
      current = parent
    }
    active.add(current.id)
  }
  return active.size
}
