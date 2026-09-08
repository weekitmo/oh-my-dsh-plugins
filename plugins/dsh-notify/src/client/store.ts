import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AttentionEntry, NotificationSettings } from '../contract.ts'
import { attentionEntries, clearAttention, defaultNotificationSettings, filterAttentionBySettings, normalizeNotificationSettings, putAttention, retainAttention, type AttentionState } from './state.ts'

export { attentionEntries, defaultNotificationSettings, filterAttentionBySettings, normalizeNotificationSettings }
export type { AttentionState }

const SETTINGS_KEY = 'dsh-notify.v1'

function persistedSettings(): NotificationSettings {
  const defaults = defaultNotificationSettings()
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const settings = normalizeNotificationSettings(raw === null ? defaults : JSON.parse(raw) as unknown)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return settings
  } catch {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults)) } catch { /* Storage remains unavailable. */ }
    return defaults
  }
}

export function createNotificationSettingsStore(): SnapshotStore<NotificationSettings> {
  const normalized = persistedSettings()
  const store = createSnapshotStore(defaultNotificationSettings(), { persist: { name: SETTINGS_KEY } })
  store.set(normalized)
  return store
}

export interface AttentionStore extends SnapshotStore<AttentionState> {
  put(entry: AttentionEntry): void
  clear(sessionId: string): void
  retain(sessionIds: ReadonlySet<string>): void
  filter(settings: NotificationSettings): void
}

export function createAttentionStore(): AttentionStore {
  const store = createSnapshotStore<AttentionState>({ bySession: {} })
  return Object.assign(store, {
    put(entry: AttentionEntry): void {
      const current = store.getSnapshot()
      store.update(draft => { Object.assign(draft, putAttention(current, entry)) })
    },
    clear(sessionId: string): void {
      const current = store.getSnapshot()
      const next = clearAttention(current, sessionId)
      if (next === current) return
      store.update(draft => { Object.assign(draft, next) })
    },
    retain(sessionIds: ReadonlySet<string>): void {
      const current = store.getSnapshot()
      const next = retainAttention(current, sessionIds)
      if (next === current) return
      store.update(draft => { Object.assign(draft, next) })
    },
    filter(settings: NotificationSettings): void {
      const current = store.getSnapshot()
      const next = filterAttentionBySettings(current, settings)
      if (next === current) return
      store.update(draft => { Object.assign(draft, next) })
    },
  })
}
