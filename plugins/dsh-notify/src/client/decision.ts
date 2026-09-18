import type { AttentionReason, AttentionTone, NotificationReason, NotificationSettings } from '../contract.ts'

/** Projection reasons are the host's turn/end vocabulary; `approval` is client-raised. */
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

export function toneOf(reason: AttentionReason): AttentionTone {
  switch (reason) {
    case 'completed': return 'success'
    case 'approval': return 'attention'
    default: return 'error'
  }
}

export function reasonEnabled(settings: NotificationSettings, reason: AttentionReason): boolean {
  switch (reason) {
    case 'completed': return settings.notifyCompleted
    case 'error': return settings.notifyError
    case 'aborted': return settings.notifyAborted
    case 'blocked': return settings.notifyBlocked
    case 'max-tokens': return settings.notifyMaxTokens
    case 'approval': return settings.notifyApproval
  }
}
