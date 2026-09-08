import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  Button,
  IconChevronDownOutline14,
  Input,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  RETENTION_PRESETS,
  retentionInputToHours,
  type RetentionSettings,
  type RetentionUnit,
} from './retention-settings.ts'
import styles from './RetentionSettingsRow.module.css'

type T = TranslateNS<'dsh.trace'>
type RetentionMode = '24' | '72' | '168' | 'custom'

export interface RetentionSettingsRowInjected {
  readonly scope: SettingsScope<RetentionSettings>
}

export type RetentionSettingsRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'dsh.trace'> & RetentionSettingsRowInjected

function presetLabel(hours: number, t: T): string {
  if (hours === 24) return t('settings.retention24h')
  if (hours === 72) return t('settings.retention3d')
  return t('settings.retention7d')
}

function modeOf(hours: number | undefined): RetentionMode {
  if (hours !== undefined && RETENTION_PRESETS.includes(hours as typeof RETENTION_PRESETS[number])) {
    return String(hours) as RetentionMode
  }
  return 'custom'
}

export function RetentionSettingsRow({ scope, t }: RetentionSettingsRowProps): ReactNode {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const current = snapshot.value?.retentionHours
  const [mode, setMode] = useState<RetentionMode>(() => modeOf(current))
  const [custom, setCustom] = useState('')
  const [unit, setUnit] = useState<RetentionUnit>('hours')
  const [unitOpen, setUnitOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [touched, setTouched] = useState(false)
  const customHours = retentionInputToHours(custom, unit)
  const busy = saving || snapshot.status === 'loading'

  useEffect(() => {
    const nextMode = modeOf(current)
    setMode(nextMode)
    if (current === undefined || nextMode !== 'custom') return
    setCustom(String(current))
    setUnit('hours')
  }, [current])

  if (snapshot.status === 'unavailable') return null

  const save = async (hours: number): Promise<void> => {
    if (!snapshot.writable || saving || hours === current) return
    setSaving(true)
    setFailure(undefined)
    try {
      await scope.set('retentionHours', hours)
      setTouched(false)
    } catch (error) {
      setMode(modeOf(current))
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const choosePreset = (hours: number): void => {
    setMode(String(hours) as RetentionMode)
    void save(hours)
  }
  const unitLabel = unit === 'hours' ? t('settings.retentionHours') : t('settings.retentionDays')

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.title}>{t('settings.retentionTitle')}</div>
        {failure !== undefined && <div className={styles.error} role="alert">{failure}</div>}
      </div>
      <div className={styles.control}>
        <div className={styles.presets} role="group" aria-label={t('settings.retentionTitle')}>
          {RETENTION_PRESETS.map(hours => (
            <button
              key={hours}
              type="button"
              className={mode === String(hours) ? styles.selected : undefined}
              aria-pressed={mode === String(hours)}
              disabled={busy || !snapshot.writable}
              onClick={() => { choosePreset(hours) }}
            >
              {presetLabel(hours, t)}
            </button>
          ))}
          <button
            type="button"
            className={mode === 'custom' ? styles.selected : undefined}
            aria-pressed={mode === 'custom'}
            disabled={busy || !snapshot.writable}
            onClick={() => { setMode('custom') }}
          >
            {t('settings.retentionCustom')}
          </button>
        </div>
        {mode === 'custom' && (
          <div className={styles.customArea}>
            <div className={styles.custom}>
              <Input
                type="number"
                min="1"
                step="1"
                value={custom}
                placeholder={t('settings.retentionCustomValue')}
                aria-label={t('settings.retentionCustomValue')}
                disabled={busy || !snapshot.writable}
                onChange={(event) => {
                  setCustom(event.target.value)
                  setTouched(true)
                }}
              />
              <Menu
                open={unitOpen}
                onClose={() => { setUnitOpen(false) }}
                items={[
                  { id: 'hours', label: t('settings.retentionHours') },
                  { id: 'days', label: t('settings.retentionDays') },
                ]}
                selectedId={unit}
                onSelect={(id) => {
                  setUnit(id as RetentionUnit)
                  setTouched(true)
                  setUnitOpen(false)
                }}
                align="end"
                portal
                anchor={(
                  <button
                    type="button"
                    className={styles.unitSelector}
                    aria-label={t('settings.retentionUnit')}
                    aria-haspopup="menu"
                    aria-expanded={unitOpen}
                    disabled={busy || !snapshot.writable}
                    onClick={() => { setUnitOpen(open => !open) }}
                  >
                    <span>{unitLabel}</span>
                    <IconChevronDownOutline14 />
                  </button>
                )}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !snapshot.writable || customHours === undefined || customHours === current}
                onClick={() => { if (customHours !== undefined) void save(customHours) }}
              >
                {saving ? t('settings.retentionSaving') : t('settings.retentionApply')}
              </Button>
            </div>
            {touched && customHours === undefined && <span className={styles.validation}>{t('settings.retentionInvalid')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
