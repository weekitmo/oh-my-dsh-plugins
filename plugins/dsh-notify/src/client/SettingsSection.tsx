import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DingTalkPublicSettings, DingTalkSettingsUpdate, NotificationSettings } from '../contract.ts'
import type { NotifyKey } from './locales.ts'
import { notificationsApi } from './notifier.ts'
import { MAX_MAX_BODY_CHARS, MIN_MAX_BODY_CHARS, validMaxBodyChars } from './state.ts'

const DINGTALK_DOCS = 'https://open.dingtalk.com/document/dingstart/custom-bot-creation-and-installation'

export interface SettingsInjected {
  hooks: { settings: SnapshotStore<NotificationSettings> }
  set: (patch: Partial<NotificationSettings>) => void
  requestPermission: () => Promise<NotificationPermission>
  sendTest: () => void
  loadDingTalk: () => Promise<DingTalkPublicSettings>
  saveDingTalk: (update: DingTalkSettingsUpdate) => Promise<DingTalkPublicSettings>
  testDingTalk: () => Promise<void>
}

type Props = PropsRuntime<'settings.section'> & InjectFace<SettingsInjected> & PropsLocale<'dsh-notify'>
type BooleanField = Exclude<keyof NotificationSettings, 'titleAnimation' | 'maxBodyChars'>

function Toggle({ checked, label, desc, disabled = false, onChange }: {
  checked: boolean
  label: string
  desc?: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="dsh_notify_toggle" data-disabled={disabled ? 'true' : 'false'}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => { onChange(event.target.checked) }} />
      <span><strong>{label}</strong>{desc === undefined ? null : <small>{desc}</small>}</span>
    </label>
  )
}

function MaxBodyCharsSetting({ value, set, t }: { value: number; set: SettingsInjected['set']; t: Props['t'] }) {
  const [input, setInput] = useState(String(value))
  useEffect(() => { setInput(String(value)) }, [value])
  const parsed = Number(input)
  const valid = input.trim() !== '' && validMaxBodyChars(parsed)
  return (
    <label className="dsh_notify_numberField">
      <span>{t('settings.system.maxBodyChars')}</span>
      <input
        type="number"
        min={MIN_MAX_BODY_CHARS}
        max={MAX_MAX_BODY_CHARS}
        step={1}
        value={input}
        aria-invalid={!valid}
        aria-describedby="dsh-notify-max-body-desc"
        onChange={event => {
          const next = event.target.value
          setInput(next)
          const number = Number(next)
          if (next.trim() !== '' && validMaxBodyChars(number)) set({ maxBodyChars: number })
        }}
      />
      <small id="dsh-notify-max-body-desc" data-error={!valid ? 'true' : 'false'}>
        {t(valid ? 'settings.system.maxBodyCharsDesc' : 'settings.system.maxBodyCharsError')}
      </small>
    </label>
  )
}

const OUTCOMES: ReadonlyArray<{ field: BooleanField; key: NotifyKey }> = [
  { field: 'notifyCompleted', key: 'settings.outcomes.completed' },
  { field: 'notifyError', key: 'settings.outcomes.error' },
  { field: 'notifyAborted', key: 'settings.outcomes.aborted' },
  { field: 'notifyBlocked', key: 'settings.outcomes.blocked' },
  { field: 'notifyMaxTokens', key: 'settings.outcomes.maxTokens' },
]

function SecretVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg className="dsh_notify_eyeIcon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {visible
        ? <>
            <path d="M876.8 156.8c0-9.6-3.2-16-9.6-22.4s-12.8-9.6-22.4-9.6-16 3.2-22.4 9.6L736 220.8c-64-32-137.6-51.2-224-60.8-160 16-288 73.6-377.6 176S0 496 0 512s48 73.6 134.4 176c22.4 25.6 44.8 48 73.6 67.2l-86.4 89.6c-6.4 6.4-9.6 12.8-9.6 22.4s3.2 16 9.6 22.4 12.8 9.6 22.4 9.6 16-3.2 22.4-9.6l704-710.4c3.2-6.4 6.4-12.8 6.4-22.4m-646.4 528Q115.2 579.2 76.8 512q43.2-72 153.6-172.8C304 272 400 230.4 512 224c64 3.2 124.8 19.2 176 44.8l-54.4 54.4C598.4 300.8 560 288 512 288c-64 0-115.2 22.4-160 64s-64 96-64 160c0 48 12.8 89.6 35.2 124.8L256 707.2c-9.6-6.4-19.2-16-25.6-22.4m140.8-96Q352 555.2 352 512c0-44.8 16-83.2 48-112s67.2-48 112-48c28.8 0 54.4 6.4 73.6 19.2zM889.599 336c-12.8-16-28.8-28.8-41.6-41.6l-48 48c73.6 67.2 124.8 124.8 150.4 169.6q-43.2 72-153.6 172.8c-73.6 67.2-172.8 108.8-284.8 115.2-51.2-3.2-99.2-12.8-140.8-28.8l-48 48c57.6 22.4 118.4 38.4 188.8 44.8 160-16 288-73.6 377.6-176S1024 528 1024 512s-48.001-73.6-134.401-176" />
            <path d="M511.998 672c-12.8 0-25.6-3.2-38.4-6.4l-51.2 51.2c28.8 12.8 57.6 19.2 89.6 19.2 64 0 115.2-22.4 160-64 41.6-41.6 64-96 64-160 0-32-6.4-64-19.2-89.6l-51.2 51.2c3.2 12.8 6.4 25.6 6.4 38.4 0 44.8-16 83.2-48 112s-67.2 48-112 48" />
          </>
        : <path d="M512 160c320 0 512 352 512 352S832 864 512 864 0 512 0 512s192-352 512-352m0 64c-225.28 0-384.128 208.064-436.8 288 52.608 79.872 211.456 288 436.8 288 225.28 0 384.128-208.064 436.8-288-52.608-79.872-211.456-288-436.8-288m0 64a224 224 0 1 1 0 448 224 224 0 0 1 0-448m0 64a160.19 160.19 0 0 0-160 160c0 88.192 71.744 160 160 160s160-71.808 160-160-71.744-160-160-160" />}
    </svg>
  )
}

function SecretInput({ label, value, placeholder, onChange, t }: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  t: Props['t']
}) {
  const [visible, setVisible] = useState(false)
  const action = t(visible ? 'settings.dingtalk.hideSecret' : 'settings.dingtalk.showSecret')
  return (
    <label>
      <span>{label}</span>
      <span className="dsh_notify_secretInput">
        <input type={visible ? 'text' : 'password'} autoComplete="off" value={value} placeholder={placeholder} onChange={event => { onChange(event.target.value) }} />
        <button type="button" aria-label={`${action}: ${label}`} title={action} aria-pressed={visible} onClick={() => { setVisible(current => !current) }}>
          <SecretVisibilityIcon visible={visible} />
        </button>
      </span>
    </label>
  )
}

function DingTalkSettings({ loadDingTalk, saveDingTalk, testDingTalk, t }: Pick<Props, 'loadDingTalk' | 'saveDingTalk' | 'testDingTalk' | 't'>) {
  const [settings, setSettings] = useState<DingTalkPublicSettings | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void loadDingTalk().then(value => { if (active) setSettings(value) }).catch(error => {
      if (active) setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [loadDingTalk])

  const patch = <K extends keyof DingTalkPublicSettings>(field: K, value: DingTalkPublicSettings[K]): void => {
    setSettings(current => current === null ? current : { ...current, [field]: value })
    setStatus(null)
  }
  const save = async (): Promise<void> => {
    if (settings === null) return
    if ((accessToken.trim() === '') !== (signingSecret.trim() === '')) {
      setStatus({ tone: 'error', text: t('settings.dingtalk.credentialsTogether') })
      return
    }
    setBusy('save')
    setStatus(null)
    try {
      const next = await saveDingTalk({
        accessToken: accessToken.trim() || undefined,
        signingSecret: signingSecret.trim() || undefined,
        notifyCompleted: settings.notifyCompleted,
        notifyFailed: settings.notifyFailed,
        quietHoursEnabled: settings.quietHoursEnabled,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        notifyMissed: settings.notifyMissed,
      })
      setSettings(next)
      setAccessToken('')
      setSigningSecret('')
      setStatus({ tone: 'success', text: t('settings.dingtalk.saved') })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }
  const clear = async (): Promise<void> => {
    if (settings === null) return
    setBusy('clear')
    setStatus(null)
    try {
      const next = await saveDingTalk({
        clearCredentials: true,
        notifyCompleted: settings.notifyCompleted,
        notifyFailed: settings.notifyFailed,
        quietHoursEnabled: settings.quietHoursEnabled,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        notifyMissed: settings.notifyMissed,
      })
      setSettings(next)
      setAccessToken('')
      setSigningSecret('')
      setStatus({ tone: 'success', text: t('settings.dingtalk.cleared') })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }
  const test = async (): Promise<void> => {
    setBusy('test')
    setStatus(null)
    try {
      await testDingTalk()
      setStatus({ tone: 'success', text: t('settings.dingtalk.testSent') })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dsh_notify_group">
      <div className="dsh_notify_groupHeading">
        <div>
          <h3>{t('settings.dingtalk.title')}</h3>
          <p>{t('settings.dingtalk.desc')}</p>
        </div>
        <button type="button" className="dsh_notify_button" onClick={() => { window.open(DINGTALK_DOCS, '_blank', 'noopener,noreferrer') }}>
          {t('settings.dingtalk.docs')}
        </button>
      </div>
      {settings === null ? (status === null
        ? <p className="dsh_notify_hint">{t('settings.dingtalk.loading')}</p>
        : <p className="dsh_notify_feedback" data-tone="error">{status.text}</p>) : (
        <>
          <div className="dsh_notify_statusLine" data-configured={settings.configured ? 'true' : 'false'}>
            <span aria-hidden="true" />
            {settings.configured ? t('settings.dingtalk.configured') : t('settings.dingtalk.notConfigured')}
          </div>
          <div className="dsh_notify_fields">
            <SecretInput label="Access Token" value={accessToken} placeholder={settings.configured ? t('settings.dingtalk.keepValue') : ''} t={t} onChange={value => { setAccessToken(value); setStatus(null) }} />
            <SecretInput label="Signing Secret" value={signingSecret} placeholder={settings.configured ? t('settings.dingtalk.keepValue') : ''} t={t} onChange={value => { setSigningSecret(value); setStatus(null) }} />
          </div>
          <div className="dsh_notify_subgroup">
            <strong>{t('settings.dingtalk.outcomes')}</strong>
            <div className="dsh_notify_outcomes">
              <Toggle checked={settings.notifyCompleted} label={t('settings.dingtalk.completed')} onChange={checked => { patch('notifyCompleted', checked) }} />
              <Toggle checked={settings.notifyFailed} label={t('settings.dingtalk.failed')} desc={t('settings.dingtalk.failedDesc')} onChange={checked => { patch('notifyFailed', checked) }} />
            </div>
          </div>
          <div className="dsh_notify_subgroup">
            <Toggle checked={settings.quietHoursEnabled} label={t('settings.dingtalk.quiet')} desc={t('settings.dingtalk.quietDesc')} onChange={checked => { patch('quietHoursEnabled', checked) }} />
            <div className="dsh_notify_timeRange" data-disabled={!settings.quietHoursEnabled ? 'true' : 'false'}>
              <label><span>{t('settings.dingtalk.start')}</span><input type="time" disabled={!settings.quietHoursEnabled} value={settings.quietHoursStart} onChange={event => { patch('quietHoursStart', event.target.value) }} /></label>
              <span aria-hidden="true">-</span>
              <label><span>{t('settings.dingtalk.end')}</span><input type="time" disabled={!settings.quietHoursEnabled} value={settings.quietHoursEnd} onChange={event => { patch('quietHoursEnd', event.target.value) }} /></label>
            </div>
            <Toggle checked={settings.notifyMissed} disabled={!settings.quietHoursEnabled} label={t('settings.dingtalk.missed')} onChange={checked => { patch('notifyMissed', checked) }} />
          </div>
          <div className="dsh_notify_actions">
            <button type="button" className="dsh_notify_button dsh_notify_buttonPrimary" disabled={busy !== null} onClick={() => { void save() }}>{busy === 'save' ? t('settings.dingtalk.saving') : t('settings.dingtalk.save')}</button>
            <button type="button" className="dsh_notify_button" disabled={busy !== null || !settings.configured} onClick={() => { void test() }}>{busy === 'test' ? t('settings.dingtalk.testing') : t('settings.dingtalk.test')}</button>
            <button type="button" className="dsh_notify_button dsh_notify_buttonDanger" disabled={busy !== null || !settings.configured} onClick={() => { void clear() }}>{busy === 'clear' ? t('settings.dingtalk.clearing') : t('settings.dingtalk.clear')}</button>
          </div>
          {status === null ? null : <p className="dsh_notify_feedback" data-tone={status.tone}>{status.text}</p>}
        </>
      )}
    </div>
  )
}

export function NotifySettingsSection({ useSettings, set, requestPermission, sendTest, loadDingTalk, saveDingTalk, testDingTalk, t }: Props) {
  const settings = useSettings(value => value)
  const [permission, setPermission] = useState<NotificationPermission>(() => notificationsApi()?.permission ?? 'denied')
  const [hint, setHint] = useState<NotifyKey | null>(null)

  useEffect(() => {
    const refresh = (): void => { setPermission(notificationsApi()?.permission ?? 'denied') }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const change = (field: BooleanField, checked: boolean): void => { set({ [field]: checked } as Partial<NotificationSettings>) }
  const authorize = async (): Promise<NotificationPermission> => {
    const next = await requestPermission()
    setPermission(next)
    setHint(next === 'granted' ? null : next === 'denied' ? 'settings.permission.deniedHint' : 'settings.permission.defaultHint')
    return next
  }
  const test = async (): Promise<void> => {
    const current = notificationsApi()?.permission === 'granted' ? 'granted' : await authorize()
    if (current === 'granted') sendTest()
  }

  return (
    <section className="dsh_notify_settings" aria-labelledby="dsh-notify-heading">
      <header>
        <h2 id="dsh-notify-heading">{t('settings.title')}</h2>
        <p>{t('settings.subtitle')}</p>
      </header>
      <div className="dsh_notify_group">
        <Toggle checked={settings.enabled} label={t('settings.enabled')} desc={t('settings.enabledDesc')} onChange={checked => { change('enabled', checked) }} />
      </div>
      <div className="dsh_notify_group">
        <h3>{t('settings.system.title')}</h3>
        <Toggle checked={settings.systemNotifications} label={t('settings.system.enabled')} onChange={checked => { change('systemNotifications', checked) }} />
        <Toggle checked={settings.backgroundOnly} label={t('settings.system.backgroundOnly')} onChange={checked => { change('backgroundOnly', checked) }} />
        <MaxBodyCharsSetting value={settings.maxBodyChars} set={set} t={t} />
        <div className="dsh_notify_permission">
          <span>{t('settings.permission.title')}: <b data-permission={permission}>{t(`settings.permission.${permission}`)}</b></span>
          <button type="button" onClick={() => { void authorize() }}>{t('settings.permission.request')}</button>
          <button type="button" onClick={() => { void test() }}>{t('settings.permission.test')}</button>
        </div>
        {hint === null ? null : <p className="dsh_notify_hint">{t(hint)}</p>}
      </div>
      <DingTalkSettings loadDingTalk={loadDingTalk} saveDingTalk={saveDingTalk} testDingTalk={testDingTalk} t={t} />
      <div className="dsh_notify_group">
        <h3>{t('settings.titleSurface.title')}</h3>
        <Toggle checked={settings.titleNotifications} label={t('settings.titleSurface.enabled')} onChange={checked => { change('titleNotifications', checked) }} />
        <Toggle checked={settings.runningTitleIndicator} label={t('settings.titleSurface.running')} onChange={checked => { change('runningTitleIndicator', checked) }} />
        <Toggle checked={settings.idleTitleAnimation} label={t('settings.titleSurface.idleAnimation')} desc={t('settings.titleSurface.idleAnimationDesc')} onChange={checked => { change('idleTitleAnimation', checked) }} />
        <Toggle checked={settings.idleFaviconIndicator} label={t('settings.titleSurface.idleFavicon')} desc={t('settings.titleSurface.idleFaviconDesc')} onChange={checked => { change('idleFaviconIndicator', checked) }} />
        <div className="dsh_notify_segment" role="group" aria-label={t('settings.titleSurface.animation')}>
          <button type="button" aria-pressed={settings.titleAnimation === 'marquee'} onClick={() => { set({ titleAnimation: 'marquee' }) }}>{t('settings.titleSurface.marquee')}</button>
          <button type="button" aria-pressed={settings.titleAnimation === 'blink'} onClick={() => { set({ titleAnimation: 'blink' }) }}>{t('settings.titleSurface.blink')}</button>
        </div>
      </div>
      <div className="dsh_notify_group">
        <h3>{t('settings.sidebar.title')}</h3>
        <Toggle checked={settings.sidebarIndicators} label={t('settings.sidebar.enabled')} desc={t('settings.sidebar.desc')} onChange={checked => { change('sidebarIndicators', checked) }} />
      </div>
      <div className="dsh_notify_group">
        <h3>{t('settings.outcomes.title')}</h3>
        <div className="dsh_notify_outcomes">
          {OUTCOMES.map(item => <Toggle key={item.field} checked={settings[item.field]} label={t(item.key)} onChange={checked => { change(item.field, checked) }} />)}
        </div>
      </div>
    </section>
  )
}
