import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  CodeBlock,
  IconApiOutline14,
  IconCodeOutline16,
  IconSettingsOutline16,
  IconSparkle16,
  IconThinkOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationAttachment,
  ConversationMessage,
  ConversationRole,
  ConversationTool,
  TraceConversation,
} from './conversation-data.ts'
import styles from './RequestsView.module.css'

type T = TranslateNS<'dsh.trace'>

const LONG_TEXT = 1_200

function roleLabel(role: ConversationRole, t: T): string {
  if (role === 'system') return t('requests.roleSystem')
  if (role === 'developer') return t('requests.roleDeveloper')
  if (role === 'user') return t('requests.roleUser')
  if (role === 'assistant') return t('requests.roleAssistant')
  return t('requests.roleTool')
}

function roleIcon(role: ConversationRole): ReactNode {
  if (role === 'system') return <IconSettingsOutline16 />
  if (role === 'developer') return <IconCodeOutline16 />
  if (role === 'user') return <IconUserOutline16 />
  if (role === 'assistant') return <IconSparkle16 />
  return <IconApiOutline14 />
}

function LongText({ value, expanded, t }: { value: string; expanded: boolean; t: T }): ReactNode {
  const [open, setOpen] = useState(false)
  const long = value.length > LONG_TEXT
  const visible = expanded || open || !long
  return (
    <div className={styles.longText}>
      <pre className={visible ? undefined : styles.textCollapsed}>{value}</pre>
      {long && !expanded && (
        <button type="button" className={styles.expandButton} onClick={() => { setOpen(current => !current) }}>
          {open ? t('requests.collapse') : t('requests.expandChars', { count: value.length })}
        </button>
      )}
    </div>
  )
}

function attachmentLabel(item: ConversationAttachment, t: T): string {
  if (item.kind === 'image') return t('requests.attachmentImage')
  if (item.kind === 'audio') return t('requests.attachmentAudio')
  return t('requests.attachmentFile')
}

function ToolCall({ call, t }: {
  call: NonNullable<ConversationMessage['toolCalls']>[number]
  t: T
}): ReactNode {
  return (
    <div className={styles.toolCall}>
      <div className={styles.toolCallHeader}>
        <IconApiOutline14 />
        <strong>{call.name}</strong>
        {call.id !== undefined && <code>{call.id}</code>}
      </div>
      {call.arguments !== '' && (
        <details className={styles.toolDetails}>
          <summary>{t('requests.toolArguments')}</summary>
          <CodeBlock code={call.arguments} lang="json" copyLabel={t('requests.copy')} copiedLabel={t('requests.copied')} />
        </details>
      )}
    </div>
  )
}

function Message({ message, expanded, t }: {
  message: ConversationMessage
  expanded: boolean
  t: T
}): ReactNode {
  const meta: string[] = []
  if (message.content !== '') meta.push(t('requests.characters', { count: message.content.length }))
  if (message.toolCalls !== undefined) meta.push(t('requests.toolCallsCount', { count: message.toolCalls.length }))
  return (
    <article className={`${styles.message} ${styles[`role_${message.role}`]}`}>
      <div className={styles.messageHeader}>
        <span className={styles.roleIcon}>{roleIcon(message.role)}</span>
        <strong>{roleLabel(message.role, t)}</strong>
        <code>#{message.index + 1}</code>
        {meta.length > 0 && <span className={styles.messageMeta}>{meta.join(' · ')}</span>}
      </div>
      <div className={styles.messageBody}>
        {message.reasoning !== undefined && (
          <details className={styles.reasoning}>
            <summary><IconThinkOutline16 />{t('requests.reasoning')}</summary>
            <LongText value={message.reasoning} expanded={expanded} t={t} />
          </details>
        )}
        {message.content !== '' && <LongText value={message.content} expanded={expanded} t={t} />}
        {message.attachments !== undefined && (
          <div className={styles.attachments}>
            {message.attachments.map((item, index) => (
              <span key={`${item.kind}:${String(index)}`} title={item.label}>
                {attachmentLabel(item, t)}{item.label === undefined ? '' : ` · ${item.label}`}
              </span>
            ))}
          </div>
        )}
        {message.toolCalls !== undefined && (
          <div className={styles.toolCalls}>
            {message.toolCalls.map((call, index) => <ToolCall key={call.id ?? `${call.name}:${String(index)}`} call={call} t={t} />)}
          </div>
        )}
        {message.role === 'tool' && message.toolCallId !== undefined && (
          <div className={styles.toolResultRef}>{t('requests.toolResultFor', { id: message.toolCallId })}</div>
        )}
        {message.content === '' && message.reasoning === undefined && message.toolCalls === undefined && (
          <span className={styles.emptyMessage}>{t('requests.emptyMessage')}</span>
        )}
      </div>
    </article>
  )
}

function ToolDefinition({ tool, t }: { tool: ConversationTool; t: T }): ReactNode {
  return (
    <details className={styles.toolDefinition}>
      <summary>
        <IconApiOutline14 />
        <strong>{tool.name}</strong>
        {tool.description !== '' && <span>{tool.description}</span>}
      </summary>
      <CodeBlock code={JSON.stringify(tool.parameters, null, 2)} lang="json" copyLabel={t('requests.copy')} copiedLabel={t('requests.copied')} />
    </details>
  )
}

export function ConversationPreview({ conversation, t }: {
  conversation: TraceConversation
  t: T
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const request = conversation.messages.filter(message => message.phase === 'request')
  const response = conversation.messages.filter(message => message.phase === 'response')
  return (
    <div className={styles.conversation}>
      <div className={styles.conversationSummary}>
        <div>
          <strong>{t('requests.conversationPreview')}</strong>
          <span>{conversation.protocol}{conversation.model === undefined ? '' : ` · ${conversation.model}`}</span>
        </div>
        <label className={styles.expandAll}>
          <input type="checkbox" checked={expanded} onChange={event => { setExpanded(event.target.checked) }} />
          {t('requests.expandAll')}
        </label>
      </div>
      {conversation.tools.length > 0 && (
        <details className={styles.toolDirectory}>
          <summary className={styles.toolDirectorySummary}>
            <IconApiOutline14 />
            <strong>{t('requests.availableTools', { count: conversation.tools.length })}</strong>
          </summary>
          <div className={styles.toolDirectoryBody}>
            {conversation.tools.map(tool => <ToolDefinition key={tool.name} tool={tool} t={t} />)}
          </div>
        </details>
      )}
      {request.length > 0 && (
        <details className={styles.requestContextGroup}>
          <summary className={styles.requestContextSummary}>
            <strong>{t('requests.requestContext')}</strong>
            <span>{request.length}</span>
          </summary>
          <div className={styles.requestContextBody}>
            {request.map(message => <Message key={message.index} message={message} expanded={expanded} t={t} />)}
          </div>
        </details>
      )}
      <section className={styles.messageGroup}>
        <div className={styles.phaseLabel}><span>{t('requests.modelResponse')}</span></div>
        {response.length > 0
          ? response.map(message => <Message key={message.index} message={message} expanded={expanded} t={t} />)
          : <div className={styles.noResponsePreview}>{t('requests.noResponsePreview')}</div>}
      </section>
    </div>
  )
}
