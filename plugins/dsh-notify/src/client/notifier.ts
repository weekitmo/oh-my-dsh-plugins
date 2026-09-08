import type { AttentionEntry, NotificationReason, NotificationSettings } from '../contract.ts'

export function notificationsApi(): typeof Notification | undefined {
  return typeof Notification === 'undefined' ? undefined : Notification
}

/** Create a browser notification without allowing browser/OS failures to break the client fiber. */
export function createNotification(
  api: typeof Notification,
  title: string,
  options: NotificationOptions,
): Notification | undefined {
  try {
    return new api(title, options)
  } catch (error) {
    console.warn('[dsh-notify] browser notification could not be created', error)
    return undefined
  }
}


export interface ManagedNotification {
  onclick: ((this: Notification, event: Event) => unknown) | null
  onclose: ((this: Notification, event: Event) => unknown) | null
  close(): void
}

export class NotificationRegistry {
  private readonly active = new Set<ManagedNotification>()

  track(notification: ManagedNotification): void {
    this.active.add(notification)
    notification.onclose = () => { this.active.delete(notification) }
  }

  closeAll(): void {
    for (const notification of this.active) {
      notification.onclick = null
      notification.onclose = null
      notification.close()
    }
    this.active.clear()
  }
}

export function shouldShowSystem(
  permission: NotificationPermission,
  settings: NotificationSettings,
  documentHidden: boolean,
  completedSessionId: string,
  currentSessionId: string | undefined,
): boolean {
  if (!settings.enabled || !settings.systemNotifications || permission !== 'granted') return false
  return !settings.backgroundOnly || documentHidden || completedSessionId !== currentSessionId
}

export function notificationTitleKey(reason: NotificationReason):
  | 'notify.completed' | 'notify.error' | 'notify.aborted' | 'notify.blocked' | 'notify.maxTokens' {
  switch (reason) {
    case 'completed': return 'notify.completed'
    case 'error': return 'notify.error'
    case 'aborted': return 'notify.aborted'
    case 'blocked': return 'notify.blocked'
    case 'max-tokens': return 'notify.maxTokens'
  }
}

export function notificationBody(entry: AttentionEntry, fallback: string, maxBodyChars: number): string {
  const source = entry.body.trim() === '' ? fallback : entry.body.trim()
  const characters = Array.from(source)
  const body = characters.length <= maxBodyChars
    ? source
    : characters.slice(0, Math.max(0, maxBodyChars - 1)).join('') + '…'
  return `${entry.title}: ${body}`
}
