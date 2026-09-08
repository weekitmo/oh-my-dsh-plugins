import type { AttentionTone, NotificationReason, NotificationSettings } from '../contract.ts'

export function asReason(reason: string | undefined): NotificationReason | undefined {
  switch (reason) {
    case 'completed':
    case 'error':
    case 'aborted':
    case 'blocked':
    case 'max-tokens':
      return reason
    case 'interrupted':
      return 'aborted'
    default:
      return undefined
  }
}

export function toneOf(reason: NotificationReason): AttentionTone {
  return reason === 'completed' ? 'success' : 'error'
}

export function reasonEnabled(settings: NotificationSettings, reason: NotificationReason): boolean {
  switch (reason) {
    case 'completed': return settings.notifyCompleted
    case 'error': return settings.notifyError
    case 'aborted': return settings.notifyAborted
    case 'blocked': return settings.notifyBlocked
    case 'max-tokens': return settings.notifyMaxTokens
  }
}
