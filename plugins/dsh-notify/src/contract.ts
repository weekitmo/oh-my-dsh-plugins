import type {} from '@deepseek-ai/dsh-session-projection/types'

export type NotificationReason = 'completed' | 'error' | 'aborted' | 'blocked' | 'max-tokens'
/**
 * Attention reasons the browser client can raise: the host completion reasons
 * plus `approval` — a pending approval request never ends its turn, so it never
 * reaches the turn/end-derived set and carries its own client-side trigger.
 */
export type AttentionReason = NotificationReason | 'approval'
export type AttentionTone = 'success' | 'error' | 'attention'
export type TitleAnimation = 'marquee' | 'blink'
/** Every outcome an attention entry can carry, in display order. */
export const ATTENTION_REASONS: readonly AttentionReason[] = ['approval', 'completed', 'error', 'aborted', 'blocked', 'max-tokens']

export interface NotifyProjectionValue {
  readonly turn: number
  readonly reason: string
  readonly body: string
  readonly startedAsyncDelegation: boolean
}

export interface DingTalkPublicSettings {
  readonly configured: boolean
  readonly notifyCompleted: boolean
  readonly notifyFailed: boolean
  readonly quietHoursEnabled: boolean
  readonly quietHoursStart: string
  readonly quietHoursEnd: string
  readonly notifyMissed: boolean
}

export interface DingTalkSettingsUpdate extends Omit<DingTalkPublicSettings, 'configured'> {
  readonly accessToken?: string
  readonly signingSecret?: string
  readonly clearCredentials?: boolean
}

export interface DingTalkNotification {
  readonly eventId: string
  readonly sessionId: string
  readonly turn: number
  readonly reason: NotificationReason
  readonly title: string
  readonly body: string
}

export interface NotificationSettings {
  readonly enabled: boolean
  readonly systemNotifications: boolean
  readonly titleNotifications: boolean
  readonly runningTitleIndicator: boolean
  readonly idleTitleAnimation: boolean
  readonly idleFaviconIndicator: boolean
  readonly sidebarIndicators: boolean
  readonly titleAnimation: TitleAnimation
  readonly maxBodyChars: number
  readonly backgroundOnly: boolean
  readonly notifyCompleted: boolean
  readonly notifyError: boolean
  readonly notifyAborted: boolean
  readonly notifyBlocked: boolean
  readonly notifyMaxTokens: boolean
  /** Notify when an approval request is waiting for the user. */
  readonly notifyApproval: boolean
  /** Play a short sound on published results and approval requests. */
  readonly soundsEnabled: boolean
  /** Playback volume in percent (0–100). */
  readonly soundVolume: number
}

export interface AttentionEntry {
  readonly sessionId: string
  readonly turn: number
  readonly reason: AttentionReason
  readonly tone: AttentionTone
  readonly title: string
  readonly body: string
  readonly createdAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    dshNotify: import('./projection.ts').NotifyProjectionState
  }
  interface SessionProjectionMap {
    dshNotify: NotifyProjectionValue
  }
}
