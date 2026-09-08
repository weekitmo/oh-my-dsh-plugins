import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  Button,
  CodeBlock,
  IconCheckOutline16,
  IconChevronLeftOutline14,
  IconCopyOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
  JsonTree,
  Modal,
  StateDot,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  JsonValue,
  TraceBody,
  TraceRequestRecord,
  TraceRequestSummary,
} from '../trace/types.ts'
import type { TraceClient } from './trace-client.ts'
import { buildTraceConversation } from './conversation-data.ts'
import { ConversationPreview } from './ConversationPreview.tsx'
import styles from './RequestsView.module.css'

type T = TranslateNS<'dsh.trace'>

export interface RequestsViewInjected {
  readonly client: TraceClient
}

export type RequestsViewProps = ConvViewProps & RequestsViewInjected & { t: T }

function dateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(value)
}

function shortTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(value)
}

function statusKind(request: TraceRequestSummary): 'done' | 'warning' | 'error' {
  if (request.error !== undefined || request.aborted === true) return 'error'
  if (request.responseStatus === undefined || request.responseStatus >= 400) return 'warning'
  return 'done'
}

function statusLabel(request: TraceRequestSummary, t: T): string {
  if (request.aborted === true) return t('requests.aborted')
  if (request.error !== undefined) return t('requests.failed')
  if (request.responseStatus === undefined) return t('requests.noResponse')
  return `${String(request.responseStatus)}`
}

function displayUrl(raw: string): { host: string; path: string } {
  try {
    const url = new URL(raw)
    return { host: url.host, path: `${url.pathname}${url.search}` }
  } catch {
    return { host: raw, path: '' }
  }
}

function jsonObject(value: JsonValue | undefined): object | unknown[] | undefined {
  return value !== null && typeof value === 'object' ? value as object | unknown[] : undefined
}

function CopyIconButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (!await writeClipboard(text)) return
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1000)
  }
  return (
    <Tooltip label={copied ? copiedLabel : label} side="top">
      <button type="button" className={styles.iconButton} aria-label={copied ? copiedLabel : label} onClick={() => { void copy() }}>
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      </button>
    </Tooltip>
  )
}

function HeadersBlock({ headers, t }: { headers: Readonly<Record<string, string>>; t: T }): ReactNode {
  const raw = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')
  return (
    <section className={styles.dataBlock}>
      <div className={styles.blockHeader}>
        <h4>{t('requests.headers')}</h4>
        <CopyIconButton text={raw} label={t('requests.copy')} copiedLabel={t('requests.copied')} />
      </div>
      {Object.keys(headers).length === 0
        ? <div className={styles.noBody}>{t('requests.noBody')}</div>
        : (
          <div className={styles.headerTable}>
            {Object.entries(headers).map(([name, value]) => (
              <div key={name}>
                <code>{name}</code>
                <span>{value}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  )
}

function jsonLabels(t: T): JsonTreeLabels {
  return {
    copyValue: t('requests.copyValue'),
    copyJson: t('requests.copyJson'),
    copyPath: t('requests.copyPath'),
    copyPrettyJson: t('requests.copyPrettyJson'),
    copyCompactJson: t('requests.copyCompactJson'),
    copied: t('requests.copied'),
    copyFailed: t('requests.copyFailed'),
    collapseNode: t('requests.collapseNode'),
    expandNode: t('requests.expandNode'),
    copyButtonTitle: action => t('requests.copyButtonTitle', { action }),
  }
}

function BodyBlock({ body, t }: { body: TraceBody | undefined; t: T }): ReactNode {
  const [mode, setMode] = useState<'formatted' | 'raw'>(body?.parsed === undefined ? 'raw' : 'formatted')
  const parsed = jsonObject(body?.parsed)
  return (
    <section className={styles.dataBlock}>
      <div className={styles.blockHeader}>
        <div className={styles.bodyTitle}>
          <h4>{t('requests.body')}</h4>
          {body?.truncated === true && <span className={styles.warnBadge}>{t('requests.truncated')}</span>}
        </div>
        {body !== undefined && body.parsed !== undefined && (
          <div className={styles.segmented}>
            <button type="button" className={mode === 'formatted' ? styles.segmentActive : undefined} onClick={() => { setMode('formatted') }}>{t('requests.formatted')}</button>
            <button type="button" className={mode === 'raw' ? styles.segmentActive : undefined} onClick={() => { setMode('raw') }}>{t('requests.raw')}</button>
          </div>
        )}
      </div>
      {body === undefined
        ? <div className={styles.noBody}>{t('requests.noBody')}</div>
        : mode === 'formatted' && parsed !== undefined
          ? <JsonTree data={parsed} label={t('requests.body')} labels={jsonLabels(t)} className={styles.jsonTree} />
          : mode === 'formatted' && body.parsed !== undefined
            ? <CodeBlock code={JSON.stringify(body.parsed, null, 2)} lang="json" copyLabel={t('requests.copy')} copiedLabel={t('requests.copied')} />
            : <CodeBlock code={body.raw} lang={body.format === 'json' ? 'json' : body.format === 'sse' ? 'text' : body.format} copyLabel={t('requests.copy')} copiedLabel={t('requests.copied')} />}
      {body?.captureError !== undefined && <p className={styles.captureError}>{t('requests.captureError', { error: body.captureError })}</p>}
    </section>
  )
}

function Overview({ record, t }: { record: TraceRequestRecord; t: T }): ReactNode {
  const fields: Array<[string, string]> = [
    [t('requests.provider'), record.provider],
    [t('requests.model'), record.model],
    [t('requests.attempt', { attempt: record.attempt }), t('requests.duration', { duration: record.durationMs })],
    [t('requests.started'), dateTime(record.startedAt)],
    [t('requests.completed'), dateTime(record.completedAt)],
    [t('requests.logicalId'), record.logicalRequestId],
  ]
  if (record.purpose !== undefined) fields.splice(2, 0, [t('requests.purpose'), record.purpose])
  return (
    <section className={styles.overview}>
      <h4>{t('requests.overview')}</h4>
      <dl>
        {fields.map(([label, value], index) => (
          <div key={`${label}:${String(index)}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {record.error !== undefined && <pre className={styles.requestError}>{record.error}</pre>}
    </section>
  )
}

function RequestDetail({ record, loading, t, onBack }: {
  record: TraceRequestRecord | undefined
  loading: boolean
  t: T
  onBack: () => void
}): ReactNode {
  const conversation = useMemo(() => buildTraceConversation(record?.requestBody, record?.responseBody), [record])
  const [view, setView] = useState<'conversation' | 'interface'>('interface')
  useEffect(() => {
    setView(conversation === undefined ? 'interface' : 'conversation')
  }, [record?.id, conversation === undefined])
  if (loading && record === undefined) return <div className={styles.detailState}>{t('requests.detailLoading')}</div>
  if (record === undefined) return <div className={styles.detailState}>{t('requests.detailEmpty')}</div>
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label={t('requests.back')}>
          <IconChevronLeftOutline14 />
        </button>
        <div className={styles.detailTitle}>
          <div>
            <span className={styles.method}>{record.method}</span>
            <strong>{record.responseStatus ?? t('requests.noResponse')}</strong>
          </div>
          <code>{record.url}</code>
        </div>
        <CopyIconButton text={record.url} label={t('requests.copy')} copiedLabel={t('requests.copied')} />
      </div>
      <div className={styles.detailScroll}>
        <div className={styles.detailViewBar}>
          <div className={styles.segmented}>
            {conversation !== undefined && (
              <button type="button" className={view === 'conversation' ? styles.segmentActive : undefined} onClick={() => { setView('conversation') }}>{t('requests.conversationPreview')}</button>
            )}
            <button type="button" className={view === 'interface' ? styles.segmentActive : undefined} onClick={() => { setView('interface') }}>{t('requests.interfaceData')}</button>
          </div>
        </div>
        {view === 'conversation' && conversation !== undefined
          ? <ConversationPreview conversation={conversation} t={t} />
          : (
            <>
              <Overview record={record} t={t} />
              <section className={styles.exchange}>
                <div className={styles.exchangeHeader}><h3>{t('requests.request')}</h3><code>{record.method} {record.url}</code></div>
                <HeadersBlock headers={record.requestHeaders} t={t} />
                <BodyBlock body={record.requestBody} t={t} />
              </section>
              <section className={styles.exchange}>
                <div className={styles.exchangeHeader}>
                  <h3>{t('requests.response')}</h3>
                  <code>{record.responseStatus === undefined ? t('requests.noResponse') : `${String(record.responseStatus)} ${record.responseStatusText ?? ''}`}</code>
                </div>
                <HeadersBlock headers={record.responseHeaders ?? {}} t={t} />
                <BodyBlock body={record.responseBody} t={t} />
              </section>
            </>
          )}
      </div>
    </div>
  )
}

function ClearDialog({ sessionId, client, t, onClose, onCleared }: {
  sessionId: string
  client: TraceClient
  t: T
  onClose: () => void
  onCleared: () => void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const clear = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      await client.clear(sessionId)
      onCleared()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title={t('requests.clearTitle')}
      description={t('requests.clearDescription')}
      closeLabel={t('requests.close')}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t('requests.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void clear() }}>
            {busy ? t('requests.clearing') : t('requests.clearConfirm')}
          </Button>
        </>
      )}
    >
      {failure !== undefined && <p className={styles.requestError}>{failure}</p>}
    </Modal>
  )
}

export function RequestsView({ sessionId, client, t }: RequestsViewProps): ReactNode {
  const [requests, setRequests] = useState<readonly TraceRequestSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<TraceRequestRecord>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [clearOpen, setClearOpen] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = async (signal?: AbortSignal): Promise<void> => {
    try {
      const result = await client.list(String(sessionId), undefined, signal)
      setRequests(result.requests)
      setHasMore(result.hasMore)
      setFailure(undefined)
      setSelectedId(current => current !== undefined && result.requests.some(request => request.id === current)
        ? current
        : undefined)
    } catch (error) {
      if (signal?.aborted === true) return
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      if (signal?.aborted !== true) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setRequests([])
    setSelectedId(undefined)
    setDetail(undefined)
    setClearOpen(false)
    void load(controller.signal)
    return () => { controller.abort() }
  }, [client, sessionId])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => { void load() }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [autoRefresh, client, sessionId])

  useEffect(() => {
    if (selectedId === undefined) {
      setDetail(undefined)
      return
    }
    const controller = new AbortController()
    setDetailLoading(true)
    void client.get(String(sessionId), selectedId, controller.signal).then(
      record => { if (!controller.signal.aborted) setDetail(record) },
      error => { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error)) },
    ).finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => { controller.abort() }
  }, [client, selectedId, sessionId])

  const loadMore = async (): Promise<void> => {
    const last = requests.at(-1)
    if (last === undefined) return
    setLoadingMore(true)
    try {
      const result = await client.list(String(sessionId), { startedAt: last.startedAt, id: last.id })
      setRequests(current => [...current, ...result.requests])
      setHasMore(result.hasMore)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingMore(false)
    }
  }

  const selected = useMemo(() => requests.find(request => request.id === selectedId), [requests, selectedId])
  const cleared = (): void => {
    setClearOpen(false)
    setRequests([])
    setSelectedId(undefined)
    setDetail(undefined)
    setHasMore(false)
  }

  return (
    <div
      className={`${styles.root} ${selectedId === undefined ? '' : styles.detailOpen}`}
      data-conversation-composer-overlay=""
    >
      <aside className={styles.listPane}>
        <div className={styles.pageHeader}>
          <h2>{t('requests.title')}</h2>
          <div className={styles.toolbar}>
            <label className={styles.autoRefresh} title={t('requests.autoRefresh')}>
              <input type="checkbox" checked={autoRefresh} onChange={event => { setAutoRefresh(event.target.checked) }} />
              <span>{t('requests.autoRefresh')}</span>
            </label>
            <Tooltip label={t('requests.refresh')} side="bottom">
              <button type="button" className={styles.iconButton} aria-label={t('requests.refresh')} disabled={loading} onClick={() => { void load() }}><IconRefreshOutline16 /></button>
            </Tooltip>
            <Tooltip label={t('requests.clear')} side="bottom">
              <button type="button" className={styles.iconButtonDanger} aria-label={t('requests.clear')} disabled={requests.length === 0} onClick={() => { setClearOpen(true) }}><IconTrashOutline16 /></button>
            </Tooltip>
          </div>
        </div>
        {loading && requests.length === 0 && <div className={styles.listState}>{t('requests.loading')}</div>}
        {failure !== undefined && requests.length === 0 && (
          <div className={styles.listState}>
            <strong>{t('requests.error')}</strong>
            <span>{failure}</span>
            <Button size="sm" variant="outline" onClick={() => { void load() }}>{t('requests.retry')}</Button>
          </div>
        )}
        {!loading && failure === undefined && requests.length === 0 && <div className={styles.listState}>{t('requests.empty')}</div>}
        <div className={styles.requestList}>
          {requests.map((request) => {
            const url = displayUrl(request.url)
            return (
              <button
                key={request.id}
                type="button"
                className={`${styles.requestRow} ${request.id === selectedId ? styles.requestRowActive : ''}`}
                onClick={() => { setSelectedId(request.id) }}
              >
                <span className={styles.rowTop}>
                  <span className={styles.status}><StateDot state={statusKind(request)} />{statusLabel(request, t)}</span>
                  <time>{shortTime(request.startedAt)}</time>
                </span>
                <span className={styles.rowRoute}><strong>{request.method}</strong><span>{url.host}</span></span>
                <code>{url.path}</code>
                <span className={styles.rowMeta}>
                  <span>{request.provider} / {request.model}</span>
                  <span>{t('requests.duration', { duration: request.durationMs })}</span>
                  <span>{t('requests.retainedUntil', { time: dateTime(request.expiresAt) })}</span>
                  {request.attempt > 1 && <span>{t('requests.attempt', { attempt: request.attempt })}</span>}
                  {request.truncated && <span className={styles.warnText}>{t('requests.truncated')}</span>}
                </span>
              </button>
            )
          })}
          {hasMore && (
            <Button className={styles.loadMore} size="sm" variant="ghost" disabled={loadingMore} onClick={() => { void loadMore() }}>
              {loadingMore ? t('requests.loadingMore') : t('requests.loadMore')}
            </Button>
          )}
        </div>
      </aside>
      <main className={styles.detailPane}>
        <RequestDetail record={selected?.id === detail?.id ? detail : undefined} loading={detailLoading} t={t} onBack={() => { setSelectedId(undefined) }} />
      </main>
      {clearOpen && <ClearDialog sessionId={String(sessionId)} client={client} t={t} onClose={() => { setClearOpen(false) }} onCleared={cleared} />}
    </div>
  )
}
