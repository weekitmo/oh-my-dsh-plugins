import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AttentionEntry, AttentionReason, NotificationSettings } from '../contract.ts'
import { reasonEnabled, toneOf } from './decision.ts'
import { loadDingTalkSettings, saveDingTalkSettings, sendDingTalkTest } from './dingtalk.ts'
import { FaviconNotifier } from './favicon.ts'
import { NotifySettingsSection, type SettingsInjected } from './SettingsSection.tsx'
import { en, NS, zh, type NotifyKey } from './locales.ts'
import { createNotification, notificationBody, NotificationRegistry, notificationsApi, notificationTitleKey, shouldShowSystem } from './notifier.ts'
import { CompletionRunner, type CompletionListSnapshot } from './runner.ts'
import { SidebarIndicators } from './sidebar.ts'
import { SettingsNavBell } from './settings-nav.ts'
import { SoundPlayer } from './sounds.ts'
import { attentionEntries, createAttentionStore, createNotificationSettingsStore } from './store.ts'
import { runningConversationCount } from './state.ts'
import { adoptStyles } from './styles.ts'
import { aggregatedTitle, productTitleOf, recentWorkspaceSessionTitle, shellTitleOf, TitleNotifier } from './title.ts'

export const inject = ['sessions', 'slots', 'locale']

interface SessionsFace {
  readonly list: { getSnapshot(): SessionListState; subscribe(listener: () => void): () => void }
  open(id: SessionId): void
  scopeOf(ctx: ClientContext): SessionId | undefined
}

/**
 * Client projection of one forwarded `approval/request` (the fields the approval
 * panel renders; see the approval subsystem's presentation contract). Declared
 * locally because the client compilation face resolves the forwarded-event
 * union only for assemblies that import every contributing remote package.
 */
interface ApprovalAlertRequest {
  readonly toolName: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

type ApprovalAlertNext = () => Promise<unknown>

type ApprovalAlertListener = (
  this: ClientContext,
  request: ApprovalAlertRequest,
  next: ApprovalAlertNext,
) => Promise<unknown>

interface RemotesFace {
  $on(event: 'approval/request', listener: ApprovalAlertListener): () => void
}

function titleKey(reason: AttentionReason): NotifyKey {
  switch (reason) {
    case 'completed': return 'title.completed'
    case 'error': return 'title.error'
    case 'aborted': return 'title.aborted'
    case 'blocked': return 'title.blocked'
    case 'max-tokens': return 'title.maxTokens'
    case 'approval': return 'title.approval'
  }
}

export function apply(ctx: ClientContext): void {
  const disposeStyles = adoptStyles()
  ctx.effect(() => disposeStyles, 'dsh-notify: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-notify: dictionaries')

  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as unknown as SessionsFace
  const settings: SnapshotStore<NotificationSettings> = createNotificationSettingsStore()
  const attention = createAttentionStore()
  const initialList = sessions.list.getSnapshot()
  const initialSessionTitle = initialList.current === undefined ? undefined : initialList.byId[initialList.current]?.title
  const productTitle = productTitleOf(document.title, initialSessionTitle)
  const title = new TitleNotifier()
  const favicon = new FaviconNotifier()
  const notifications = new NotificationRegistry()
  const sounds = new SoundPlayer()
  const sidebar = new SidebarIndicators()
  const settingsNavBell = new SettingsNavBell(document, () => t('nav'))
  sidebar.start()
  settingsNavBell.start()

  const set = (patch: Partial<NotificationSettings>): void => {
    settings.update(draft => { Object.assign(draft, patch) })
    attention.filter(settings.getSnapshot())
  }
  const requestPermission = (): Promise<NotificationPermission> =>
    notificationsApi()?.requestPermission() ?? Promise.resolve<NotificationPermission>('denied')
  const show = (entry: AttentionEntry): void => {
    const api = notificationsApi()
    if (api === undefined) return
    const notification = createNotification(api, t(notificationTitleKey(entry.reason)), {
      body: notificationBody(entry, t('notify.bodyFallback'), settings.getSnapshot().maxBodyChars),
      tag: `dsh-notify-${entry.sessionId}-${String(entry.turn)}`,
    })
    if (notification === undefined) return
    notifications.track(notification)
    notification.onclick = () => {
      window.focus()
      sessions.open(entry.sessionId as SessionId)
      attention.clear(entry.sessionId)
      notification.close()
    }
  }
  const playSound = (reason: AttentionReason): void => {
    const current = settings.getSnapshot()
    if (!current.enabled || !current.soundsEnabled || !reasonEnabled(current, reason)) return
    sounds.play(reason, current.soundVolume)
  }
  /** Route one result to every enabled surface: attention state, system notification, sound. */
  const announce = (entry: AttentionEntry): void => {
    const current = settings.getSnapshot()
    if (!current.enabled || !reasonEnabled(current, entry.reason)) return
    const state = sessions.list.getSnapshot()
    if (state.current !== entry.sessionId || document.hidden) attention.put(entry)
    playSound(entry.reason)
    const permission = notificationsApi()?.permission ?? 'denied'
    if (shouldShowSystem(permission, current, document.hidden, entry.sessionId, state.current)) show(entry)
  }
  /** Display label for one session, used as the approval notification title. */
  const sessionLabel = (sessionId: string): string => {
    const state = sessions.list.getSnapshot()
    return state.byId[sessionId as SessionId]?.displayTitle ?? sessionId
  }
  const previewSound = (reason: AttentionReason): void => {
    sounds.play(reason, settings.getSnapshot().soundVolume)
  }
  const sendTest = (): void => {
    const api = notificationsApi()
    if (api === undefined || api.permission !== 'granted') return
    const notification = createNotification(api, t('notify.testTitle'), {
      body: t('notify.testBody'),
      tag: `dsh-notify-test-${String(Date.now())}`,
    })
    if (notification !== undefined) notifications.track(notification)
    playSound('completed')
  }

  const visibleEntries = (): AttentionEntry[] => {
    const current = settings.getSnapshot()
    if (!current.enabled) return []
    return attentionEntries(attention.getSnapshot()).filter(entry => reasonEnabled(current, entry.reason))
  }
  const renderSurfaces = (): void => {
    const current = settings.getSnapshot()
    const state = sessions.list.getSnapshot()
    const entries = visibleEntries()
    const runningCount = current.enabled ? runningConversationCount(state.ids, state.byId) : 0
    const titleRunningCount = current.runningTitleIndicator ? runningCount : 0
    const titleEntries = current.titleNotifications ? entries : []
    const titleText = aggregatedTitle(
      titleEntries,
      (reason, count) => t(titleKey(reason), { n: count }),
      titleRunningCount,
      count => t('title.running', { n: count }),
    )
    const currentSessionTitle = state.current === undefined ? undefined : state.byId[state.current]?.title
    const shellTitle = shellTitleOf(productTitle, currentSessionTitle)
    const idle = current.enabled && runningCount === 0 && entries.length === 0
    const recentTitle = recentWorkspaceSessionTitle(state.ids, state.byId)
    const idleShellTitle = shellTitleOf(productTitle, recentTitle)
    const animateIdle = idle && document.hidden && current.idleTitleAnimation && recentTitle !== undefined
    if (animateIdle) title.render(idleShellTitle, current.titleAnimation, false, true, productTitle)
    else title.render(titleText, current.titleAnimation, titleRunningCount > 0, titleEntries.length > 0, idle ? idleShellTitle : shellTitle)
    favicon.render(idle && document.hidden && current.idleFaviconIndicator)
    const sidebarEnabled = current.enabled && current.sidebarIndicators
    document.documentElement.setAttribute('data-dsh-notify-sidebar', sidebarEnabled ? 'on' : 'off')
    sidebar.render(entries, sidebarEnabled)
  }

  ctx.effect(() => {
    const completion = new CompletionRunner(
      initialList as unknown as CompletionListSnapshot,
      {
        publish(entry): void {
          announce(entry)
        },
      },
    )
    const update = (): void => {
      const state = sessions.list.getSnapshot()
      if (state.current !== undefined && !document.hidden) attention.clear(state.current)
      completion.update(state as unknown as CompletionListSnapshot)
      if (state.phase === 'ready') {
        const live = new Set<string>(state.ids)
        attention.retain(live)
      }
      renderSurfaces()
    }
    const stopList = sessions.list.subscribe(update)
    const onVisibility = (): void => {
      if (!document.hidden) {
        const current = sessions.list.getSnapshot().current
        if (current !== undefined) attention.clear(current)
      }
      renderSurfaces()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopList()
      completion.dispose()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, 'dsh-notify: session lifecycle')

  ctx.effect(() => {
    const stopAttention = attention.subscribe(renderSurfaces)
    const stopSettings = settings.subscribe(renderSurfaces)
    renderSurfaces()
    return () => {
      stopAttention()
      stopSettings()
      notifications.closeAll()
      sounds.dispose()
      sidebar.dispose()
      settingsNavBell.dispose()
      favicon.dispose()
      const state = sessions.list.getSnapshot()
      const currentSessionTitle = state.current === undefined ? undefined : state.byId[state.current]?.title
      title.dispose(shellTitleOf(productTitle, currentSessionTitle))
      document.documentElement.removeAttribute('data-dsh-notify-sidebar')
    }
  }, 'dsh-notify: surfaces')

  // Approval alerts need the forwarded Remote Events capability; every other
  // surface keeps working when a deployment does not mount it.
  ctx.inject(['remote'], (remoteCtx) => {
    const remotes = remoteCtx.get('remote') as unknown as RemotesFace
    remoteCtx.effect(() => remotes.$on('approval/request', function approvalAlert(
      this: ClientContext,
      request: ApprovalAlertRequest,
      next: ApprovalAlertNext,
    ) {
      try {
        if (request.signal?.aborted !== true) {
          const sessionId = sessions.scopeOf(this)
          if (sessionId !== undefined) {
            const reasonText = request.reason?.trim()
            announce({
              sessionId: String(sessionId),
              turn: 0,
              reason: 'approval',
              tone: toneOf('approval'),
              title: sessionLabel(String(sessionId)),
              body: reasonText === undefined || reasonText === ''
                ? t('notify.approvalBody', { tool: request.toolName })
                : `${request.toolName}: ${reasonText}`,
              createdAt: Date.now(),
            })
          }
        }
      } catch (error) {
        console.warn('[dsh-notify] approval alert failed', error)
      }
      return next()
    }), 'dsh-notify: approval alerts')
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-notify',
    order: 60,
    label: () => t('nav'),
    locale: NS,
    inject: (): SettingsInjected => ({
      hooks: { settings },
      set,
      requestPermission,
      sendTest,
      previewSound,
      loadDingTalk: loadDingTalkSettings,
      saveDingTalk: saveDingTalkSettings,
      testDingTalk: sendDingTalkTest,
    }),
  }, NotifySettingsSection))
}
