import type {} from '@deepseek-ai/dsh-session-projection/types'

export type NotificationReason = 'completed' | 'error' | 'aborted' | 'blocked' | 'max-tokens'
export type AttentionTone = 'success' | 'error'
export type TitleAnimation = 'marquee' | 'blink'

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
}

export interface AttentionEntry {
  readonly sessionId: string
  readonly turn: number
  readonly reason: NotificationReason
  readonly tone: AttentionTone
  readonly title: string
  readonly body: string
  readonly createdAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dshNotify: NotifyProjectionValue
  }
}
