import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { RequestsView, type RequestsViewInjected } from './RequestsView.tsx'
import { createTraceClient } from './trace-client.ts'
import { en, zh, type TraceLocaleKey } from './locales.ts'
import { RetentionSettingsRow, type RetentionSettingsRowInjected } from './RetentionSettingsRow.tsx'
import { retentionSettingsScope } from './retention-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh.trace': TraceLocaleKey
  }
}

const NS = 'dsh.trace'

export const inject = [
  'slots', 'locale', 'connection', 'settingsScope',
]

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-trace: dictionaries')
  const t = ctx.locale.bind(NS)
  const traces = createTraceClient(ctx)
  const retention = retentionSettingsScope(ctx.settingsScope as SettingsScopeBinder)
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'dsh-trace-retention',
    order: 40,
    locale: NS,
    inject: (): RetentionSettingsRowInjected => ({ scope: retention }),
  }, RetentionSettingsRow))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-trace-requests',
    order: 30,
    locale: NS,
    label: () => t('view.requests'),
    inject: (_sessionId: SessionId): RequestsViewInjected => ({ client: traces }),
  }, RequestsView))
}
