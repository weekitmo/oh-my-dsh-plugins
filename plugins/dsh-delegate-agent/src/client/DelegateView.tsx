import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { CodeBlock, JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ArrowLeft, ChevronRight, CircleStop, Play, RefreshCw, Save, TerminalSquare, Trash2, X,
} from 'lucide-react'
import type {
  AdapterDescriptor, AdapterId, DelegatePreset, DelegatePresetInput, DelegateTask, PermissionMode, TaskStatus,
} from '../types.ts'
import type { DelegateClient, StartTaskInput } from './delegate-client.ts'
import { DelegateSelect } from './DelegateSelect.tsx'
import { parseOutputLines, resultFormat } from './result-format.ts'
import styles from './DelegateView.module.css'

type T = TranslateNS<'dsh.delegate'>
type PresetChoice = '__direct__' | string

export interface DelegateViewInjected {
  readonly client: DelegateClient
}

export type DelegateViewProps = ConvViewProps & DelegateViewInjected & { readonly t: T }

const LIVE = new Set<TaskStatus>(['starting', 'running', 'stopping'])

function time(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(value)
}

function Status({ status, t }: { readonly status: TaskStatus; readonly t: T }): ReactNode {
  return <span className={`${styles.status} ${styles[`status_${status}`] ?? ''}`}><i />{t(status)}</span>
}

function LaunchPane({ adapters, presets, busy, t, onLaunch, onCreatePreset, onDeletePreset }: {
  readonly adapters: readonly AdapterDescriptor[]
  readonly presets: readonly DelegatePreset[]
  readonly busy: boolean
  readonly t: T
  readonly onLaunch: (input: StartTaskInput) => Promise<void>
  readonly onCreatePreset: (input: DelegatePresetInput) => Promise<DelegatePreset>
  readonly onDeletePreset: (id: string) => Promise<void>
}): ReactNode {
  const firstAvailable = adapters.find(adapter => adapter.available)?.id ?? 'pi'
  const [presetChoice, setPresetChoice] = useState<PresetChoice>('__direct__')
  const [adapterId, setAdapterId] = useState<AdapterId>(firstAvailable)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('read-only')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [provider, setProvider] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [presetEditor, setPresetEditor] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [fixedInstructions, setFixedInstructions] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [localFailure, setLocalFailure] = useState<string>()
  const adapter = adapters.find(candidate => candidate.id === adapterId)
  const selectedPreset = presetChoice === '__direct__' ? undefined : presets.find(item => item.id === presetChoice)

  const adapterOptions = useMemo(() => adapters.map(item => ({
    value: item.id,
    label: `${item.label}${item.available ? '' : ` - ${t('unavailable')}`}`,
    disabled: !item.available,
  })), [adapters, t])
  const permissionOptions = useMemo(() => [
    { value: 'read-only' as const, label: t('readOnly') },
    { value: 'workspace-write' as const, label: t('workspaceWrite') },
  ], [t])
  const presetOptions = useMemo(() => [
    { value: '__direct__', label: t('adHoc') },
    ...presets.map(item => ({ value: item.id, label: item.name })),
  ], [presets, t])

  useEffect(() => {
    if (adapter?.available !== true) setAdapterId(firstAvailable)
  }, [adapter?.available, firstAvailable])

  useEffect(() => {
    if (presetChoice !== '__direct__' && selectedPreset === undefined) setPresetChoice('__direct__')
  }, [presetChoice, selectedPreset])

  const launch = async (): Promise<void> => {
    if (prompt.trim() === '') return
    if (selectedPreset !== undefined) {
      await onLaunch({ presetId: selectedPreset.id, instruction: prompt.trim() })
    } else {
      if (adapter?.available !== true) return
      await onLaunch({
        adapterId,
        prompt: prompt.trim(),
        permissionMode,
        ...(model.trim() === '' ? {} : { model: model.trim() }),
        ...(provider.trim() === '' ? {} : { provider: provider.trim() }),
        ...(reasoning.trim() === '' ? {} : { reasoning: reasoning.trim() }),
      })
    }
    setPrompt('')
  }

  const savePreset = async (): Promise<void> => {
    if (presetName.trim() === '' || fixedInstructions.trim() === '' || adapter?.available !== true) return
    setSavingPreset(true)
    setLocalFailure(undefined)
    try {
      const created = await onCreatePreset({
        name: presetName.trim(),
        adapterId,
        permissionMode,
        fixedInstructions: fixedInstructions.trim(),
        ...(model.trim() === '' ? {} : { model: model.trim() }),
        ...(provider.trim() === '' ? {} : { provider: provider.trim() }),
        ...(reasoning.trim() === '' ? {} : { reasoning: reasoning.trim() }),
      })
      setPresetChoice(created.id)
      setPresetEditor(false)
      setPresetName('')
      setFixedInstructions('')
    } catch (error) {
      setLocalFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingPreset(false)
    }
  }

  const deletePreset = async (): Promise<void> => {
    if (selectedPreset === undefined) return
    try {
      await onDeletePreset(selectedPreset.id)
      setPresetChoice('__direct__')
      setDeleteConfirm(false)
      setLocalFailure(undefined)
    } catch (error) {
      setLocalFailure(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className={styles.launchPane}>
      <div className={styles.launchFields}>
        <label className={styles.fullField}><span>{t('preset')}</span><DelegateSelect value={presetChoice} options={presetOptions} label={t('preset')} onChange={value => { setPresetChoice(value); setDeleteConfirm(false) }} /></label>
        {selectedPreset === undefined
          ? <>
            <label><span>{t('adapter')}</span><DelegateSelect value={adapterId} options={adapterOptions} label={t('adapter')} onChange={setAdapterId} /></label>
            <label><span>{t('permission')}</span><DelegateSelect value={permissionMode} options={permissionOptions} label={t('permission')} onChange={setPermissionMode} /></label>
            <label><span>{t('model')}</span><input value={model} onChange={event => { setModel(event.target.value) }} /></label>
            {adapter?.supportsProvider === true && <label><span>{t('provider')}</span><input value={provider} onChange={event => { setProvider(event.target.value) }} /></label>}
            {adapter?.supportsReasoning === true && <label><span>{t('reasoning')}</span><input value={reasoning} onChange={event => { setReasoning(event.target.value) }} /></label>}
          </>
          : <div className={styles.presetSummary}>
            <div><strong>{selectedPreset.name}</strong><span>{selectedPreset.adapterId} · {selectedPreset.permissionMode === 'read-only' ? t('readOnly') : t('workspaceWrite')}{selectedPreset.model === undefined ? '' : ` · ${selectedPreset.model}`}</span></div>
            <p>{selectedPreset.fixedInstructions}</p>
            <button type="button" className={styles.iconButton} aria-label={t('deletePreset')} title={t('deletePreset')} onClick={() => { setDeleteConfirm(true) }}><Trash2 size={15} /></button>
          </div>}
      </div>
      {selectedPreset === undefined && adapter?.error !== undefined && <p className={styles.adapterError}>{adapter.error}</p>}
      {selectedPreset === undefined && presetEditor && <div className={styles.presetEditor}>
        <label><span>{t('presetName')}</span><input value={presetName} maxLength={100} onChange={event => { setPresetName(event.target.value) }} /></label>
        <label><span>{t('fixedInstructions')}</span><textarea rows={3} value={fixedInstructions} maxLength={100000} placeholder={t('fixedInstructionsPlaceholder')} onChange={event => { setFixedInstructions(event.target.value) }} /></label>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => { setPresetEditor(false); setLocalFailure(undefined) }}><X size={14} />{t('dismiss')}</button>
          <button type="button" className={styles.secondaryButton} disabled={savingPreset || presetName.trim() === '' || fixedInstructions.trim() === ''} onClick={() => { void savePreset() }}><Save size={14} />{savingPreset ? t('savingPreset') : t('savePreset')}</button>
        </div>
      </div>}
      {deleteConfirm && selectedPreset !== undefined && <div className={styles.confirmBar}>
        <span>{t('confirmDeletePreset')}</span>
        <div><button type="button" className={styles.textButton} onClick={() => { setDeleteConfirm(false) }}>{t('dismiss')}</button><button type="button" className={styles.dangerButton} onClick={() => { void deletePreset() }}>{t('confirm')}</button></div>
      </div>}
      {localFailure !== undefined && <p className={styles.adapterError}>{localFailure}</p>}
      <label className={styles.promptField}><span>{t('prompt')}</span><textarea rows={4} value={prompt} placeholder={t('promptPlaceholder')} onChange={event => { setPrompt(event.target.value) }} /></label>
      <div className={styles.launchActions}>
        {selectedPreset === undefined && !presetEditor && <button type="button" className={styles.secondaryButton} disabled={adapter?.available !== true} onClick={() => { setPresetEditor(true) }}><Save size={14} />{t('savePreset')}</button>}
        <button type="button" className={styles.launchButton} disabled={busy || prompt.trim() === '' || (selectedPreset === undefined && adapter?.available !== true)} onClick={() => { void launch() }}>
          <Play size={15} />{busy ? t('launching') : t('launch')}
        </button>
      </div>
    </section>
  )
}

function OutputTimeline({ text, emptyLabel, label, t }: {
  readonly text: string
  readonly emptyLabel: string
  readonly label: string
  readonly t: T
}): ReactNode {
  const [mode, setMode] = useState<'raw' | 'formatted'>('raw')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const lines = useMemo(() => parseOutputLines(text), [text])
  const labels = useMemo<JsonTreeLabels>(() => ({
    copyValue: t('copyValue'),
    copyJson: t('copyJson'),
    copyPath: t('copyPath'),
    copyPrettyJson: t('copyPrettyJson'),
    copyCompactJson: t('copyCompactJson'),
    copied: t('copied'),
    copyFailed: t('copyFailed'),
    collapseNode: t('collapseJson'),
    expandNode: t('expandJson'),
    copyButtonTitle: action => `${t('copy')}: ${action}`,
  }), [t])
  if (lines.length === 0) return <div className={styles.noOutput}>{emptyLabel}</div>

  const toggle = (index: number): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <>
      <div className={styles.outputToolbar}>
        <div className={styles.segmented} role="tablist" aria-label={t('stdoutView')}>
          <button type="button" role="tab" aria-selected={mode === 'raw'} className={mode === 'raw' ? styles.segmentActive : ''} onClick={() => { setMode('raw') }}>{t('stdoutRaw')}</button>
          <button type="button" role="tab" aria-selected={mode === 'formatted'} className={mode === 'formatted' ? styles.segmentActive : ''} onClick={() => { setMode('formatted') }}>{t('stdoutFormatted')}</button>
        </div>
      </div>
      <ol className={styles.outputTimeline} aria-label={label} data-output-mode={mode}>
        {lines.map((line, index) => {
          const isExpanded = expanded.has(index)
          return (
            <li key={index}>
              <span className={styles.outputRail} aria-hidden="true"><span>{String(index + 1).padStart(2, '0')}</span><i /></span>
              {mode === 'raw' || line.parsed === undefined
                ? <code>{line.raw === '' ? ' ' : line.raw}</code>
                : <div className={styles.structuredLine}>
                  <button type="button" className={styles.outputSummary} aria-expanded={isExpanded} onClick={() => { toggle(index) }}>
                    <ChevronRight size={14} className={isExpanded ? styles.expanderOpen : styles.expander} />
                    <strong>{line.summary}</strong>
                    <span>{Array.isArray(line.parsed) ? `${String(line.parsed.length)} ${t('items')}` : `${String(Object.keys(line.parsed).length)} ${t('fields')}`}</span>
                  </button>
                  {isExpanded && <JsonTree className={styles.outputTree} data={line.parsed} label={`${label} ${String(index + 1)}`} labels={labels} expandTopLevel />}
                </div>}
            </li>
          )
        })}
      </ol>
    </>
  )
}

function FinalResult({ text, t }: { readonly text: string | undefined; readonly t: T }): ReactNode {
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])
  if (text === undefined || text.trim() === '') return <div className={styles.noOutput}>{t('noFinalOutput')}</div>
  return resultFormat(text) === 'json'
    ? <CodeBlock className={styles.resultCode} code={text} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
    : <div className={styles.resultMarkdown}><MarkdownText text={text} labels={labels} /></div>
}

function TaskDetail({ task, t, onBack, onCancel }: {
  readonly task: DelegateTask
  readonly t: T
  readonly onBack: () => void
  readonly onCancel: () => Promise<void>
}): ReactNode {
  const [tab, setTab] = useState<'result' | 'stdout' | 'stderr' | 'events'>('result')
  const truncated = tab === 'stdout' ? task.stdoutTruncated : tab === 'stderr' ? task.stderrTruncated : false
  return (
    <main className={styles.detailPane}>
      <header className={styles.detailHeader}>
        <button type="button" className={styles.iconButtonMobile} aria-label={t('back')} title={t('back')} onClick={onBack}><ArrowLeft size={17} /></button>
        <div><strong>{task.adapterId}</strong><Status status={task.status} t={t} /></div>
        {LIVE.has(task.status) && <button type="button" className={styles.stopButton} title={t('cancel')} onClick={() => { void onCancel() }}><CircleStop size={15} />{t('cancel')}</button>}
      </header>
      <section className={styles.meta}>
        <div><span>{t('cwd')}</span><code>{task.cwd}</code></div>
        <div><span>{t('created')}</span><time>{time(task.createdAt)}</time></div>
        <div><span>{t('command')}</span><code>{task.command.join(' ')}</code></div>
      </section>
      <nav className={styles.tabs}>
        {(['result', 'stdout', 'stderr', 'events'] as const).map(value => <button key={value} type="button" className={tab === value ? styles.tabActive : ''} onClick={() => { setTab(value) }}>{t(value)}</button>)}
      </nav>
      <div className={styles.output} data-output-tab={tab}>
        {truncated && <p className={styles.truncated}>{t('truncated')}</p>}
        {tab === 'result'
          ? <FinalResult text={task.finalText} t={t} />
          : tab === 'stdout'
            ? <OutputTimeline text={task.stdout} emptyLabel={t('noOutput')} label={t('stdout')} t={t} />
            : tab === 'stderr'
              ? <pre className={styles.rawOutput}>{task.stderr || t('noOutput')}</pre>
              : <CodeBlock className={styles.eventsCode} code={JSON.stringify(task.events, null, 2)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />}
        {task.diagnostic !== undefined && tab === 'stderr' && <section className={styles.diagnostic}><strong>{t('diagnostic')}</strong><pre>{task.diagnostic}</pre></section>}
      </div>
    </main>
  )
}

export function DelegateView({ sessionId, client, t }: DelegateViewProps): ReactNode {
  const ownerSessionId = String(sessionId)
  const [adapters, setAdapters] = useState<readonly AdapterDescriptor[]>([])
  const [presets, setPresets] = useState<readonly DelegatePreset[]>([])
  const [tasks, setTasks] = useState<readonly DelegateTask[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [failure, setFailure] = useState<string>()

  const loadTasks = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const list = await client.list(ownerSessionId, signal)
      setTasks(list.tasks)
      setFailure(undefined)
    } catch (error) {
      if (signal?.aborted !== true) setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [client, ownerSessionId])

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const [nextAdapters, list, nextPresets] = await Promise.all([
        client.adapters(signal), client.list(ownerSessionId, signal), client.presets(ownerSessionId, signal),
      ])
      setAdapters(nextAdapters)
      setTasks(list.tasks)
      setPresets(nextPresets)
      setFailure(undefined)
    } catch (error) {
      if (signal?.aborted !== true) setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      if (signal?.aborted !== true) setLoading(false)
    }
  }, [client, ownerSessionId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setTasks([])
    setPresets([])
    setSelectedId(undefined)
    void load(controller.signal)
    return () => { controller.abort() }
  }, [load])

  const hasLive = tasks.some(task => LIVE.has(task.status))
  useEffect(() => {
    if (!hasLive) return
    const timer = window.setInterval(() => { void loadTasks() }, 1200)
    return () => { window.clearInterval(timer) }
  }, [hasLive, loadTasks])

  const selected = useMemo(() => tasks.find(task => task.id === selectedId), [selectedId, tasks])
  const finishedCount = useMemo(() => tasks.filter(task => !LIVE.has(task.status)).length, [tasks])
  const launch = async (input: StartTaskInput): Promise<void> => {
    setLaunching(true)
    try {
      const task = await client.start(ownerSessionId, input)
      setTasks(current => [task, ...current])
      setSelectedId(task.id)
      setFailure(undefined)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setLaunching(false)
    }
  }
  const cancel = async (task: DelegateTask): Promise<void> => {
    try {
      await client.cancel(ownerSessionId, task.id)
      await loadTasks()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }
  const createPreset = async (input: DelegatePresetInput): Promise<DelegatePreset> => {
    const created = await client.createPreset(ownerSessionId, input)
    setPresets(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
    return created
  }
  const deletePreset = async (id: string): Promise<void> => {
    await client.deletePreset(ownerSessionId, id)
    setPresets(current => current.filter(preset => preset.id !== id))
  }
  const clearHistory = async (): Promise<void> => {
    try {
      await client.clearHistory(ownerSessionId)
      setClearConfirm(false)
      setSelectedId(current => tasks.some(task => task.id === current && LIVE.has(task.status)) ? current : undefined)
      await loadTasks()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={`${styles.root} ${selected === undefined ? '' : styles.detailOpen}`} data-conversation-composer-overlay="">
      <aside className={styles.listPane}>
        <header className={styles.pageHeader}>
          <div><TerminalSquare size={17} /><h2>{t('title')}</h2></div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} aria-label={t('clearHistory')} title={t('clearHistory')} disabled={finishedCount === 0} onClick={() => { setClearConfirm(true) }}><Trash2 size={16} /></button>
            <button type="button" className={styles.iconButton} aria-label={t('refresh')} title={t('refresh')} disabled={loading} onClick={() => { void load() }}><RefreshCw size={16} /></button>
          </div>
        </header>
        {clearConfirm && <div className={styles.confirmBar}>
          <span>{t('confirmClearHistory')}</span>
          <div><button type="button" className={styles.textButton} onClick={() => { setClearConfirm(false) }}>{t('dismiss')}</button><button type="button" className={styles.dangerButton} onClick={() => { void clearHistory() }}>{t('confirm')}</button></div>
        </div>}
        <LaunchPane adapters={adapters} presets={presets} busy={launching} t={t} onLaunch={launch} onCreatePreset={createPreset} onDeletePreset={deletePreset} />
        {failure !== undefined && <p className={styles.failure}>{failure}</p>}
        {loading && tasks.length === 0 && <div className={styles.empty}>{t('loading')}</div>}
        {!loading && tasks.length === 0 && failure === undefined && <div className={styles.empty}>{t('empty')}</div>}
        <div className={styles.taskList}>
          {tasks.map(task => <button key={task.id} type="button" className={`${styles.taskRow} ${selectedId === task.id ? styles.taskRowActive : ''}`} onClick={() => { setSelectedId(task.id) }}>
            <span className={styles.taskTop}><strong>{task.adapterId}{task.model === undefined ? '' : ` / ${task.model}`}</strong><time>{time(task.createdAt)}</time></span>
            <span className={styles.taskPrompt}>{task.prompt}</span>
            <Status status={task.status} t={t} />
          </button>)}
        </div>
      </aside>
      {selected === undefined
        ? <main className={styles.placeholder}><TerminalSquare size={28} /><span>{t('empty')}</span></main>
        : <TaskDetail key={selected.id} task={selected} t={t} onBack={() => { setSelectedId(undefined) }} onCancel={() => cancel(selected)} />}
    </div>
  )
}
