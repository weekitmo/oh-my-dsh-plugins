import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { createDelegateClient } from './delegate-client.ts'
import { DelegateView, type DelegateViewInjected } from './DelegateView.tsx'
import { en, zh, type DelegateLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh.delegate': DelegateLocaleKey
  }
}

const NS = 'dsh.delegate'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-delegate-agent: dictionaries')
  const t = ctx.locale.bind(NS)
  const client = createDelegateClient(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-delegate-agent',
    order: 20,
    locale: NS,
    label: () => t('view.label'),
    inject: (_sessionId: SessionId): DelegateViewInjected => ({ client }),
  }, DelegateView))
}
