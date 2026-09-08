import { createHmac } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DingTalkNotification, DingTalkPublicSettings, DingTalkSettingsUpdate } from './contract.ts'

const DEFAULT_WEBHOOK = 'https://oapi.dingtalk.com/robot/send'
const MAX_BODY_BYTES = 64 * 1024
const MAX_QUEUE = 200
const MAX_DIGEST_CHARS = 16_000
const MAX_MESSAGE_CHARS = 700
const RECENT_EVENT_LIMIT = 1_000

export interface DingTalkStoredSettings {
  readonly accessToken: string
  readonly signingSecret: string
  readonly notifyCompleted: boolean
  readonly notifyFailed: boolean
  readonly quietHoursEnabled: boolean
  readonly quietHoursStart: string
  readonly quietHoursEnd: string
  readonly notifyMissed: boolean
}

export interface MissedMessage extends DingTalkNotification {
  readonly capturedAt: string
}

export interface MissedState {
  readonly messages: readonly MissedMessage[]
  readonly omitted: number
  readonly digest: boolean
}

export const DEFAULT_DINGTALK_SETTINGS: DingTalkStoredSettings = Object.freeze({
  accessToken: '',
  signingSecret: '',
  notifyCompleted: true,
  notifyFailed: true,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
  notifyMissed: false,
})

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function parseClock(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim())) {
    throw new Error('time must use HH:MM')
  }
  return value.trim()
}

function clockMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour! * 60 + minute!
}

export function normalizeDingTalkSettings(value: unknown): DingTalkStoredSettings {
  const source = objectValue(value)
  const start = parseClock(source.quietHoursStart ?? DEFAULT_DINGTALK_SETTINGS.quietHoursStart)
  const end = parseClock(source.quietHoursEnd ?? DEFAULT_DINGTALK_SETTINGS.quietHoursEnd)
  if (start === end) throw new Error('quiet-hours start and end must be different')
  const accessToken = typeof source.accessToken === 'string' ? source.accessToken.trim() : ''
  const signingSecret = typeof source.signingSecret === 'string' ? source.signingSecret.trim() : ''
  if ((accessToken === '') !== (signingSecret === '')) {
    throw new Error('Access Token and Signing Secret must be configured together')
  }
  return {
    accessToken,
    signingSecret,
    notifyCompleted: bool(source.notifyCompleted, true),
    notifyFailed: bool(source.notifyFailed, true),
    quietHoursEnabled: bool(source.quietHoursEnabled, false),
    quietHoursStart: start,
    quietHoursEnd: end,
    notifyMissed: bool(source.notifyMissed, DEFAULT_DINGTALK_SETTINGS.notifyMissed),
  }
}

export function publicDingTalkSettings(value: DingTalkStoredSettings): DingTalkPublicSettings {
  return {
    configured: value.accessToken !== '' && value.signingSecret !== '',
    notifyCompleted: value.notifyCompleted,
    notifyFailed: value.notifyFailed,
    quietHoursEnabled: value.quietHoursEnabled,
    quietHoursStart: value.quietHoursStart,
    quietHoursEnd: value.quietHoursEnd,
    notifyMissed: value.notifyMissed,
  }
}

function shanghaiParts(now: Date): { day: number; minute: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return {
    day: Math.floor(shifted.getTime() / 86_400_000),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

export function isQuietAt(now: Date, start: string, end: string): boolean {
  const minute = shanghaiParts(now).minute
  const startMinute = clockMinute(start)
  const endMinute = clockMinute(end)
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute
}

export function millisecondsUntilQuietEnd(now: Date, start: string, end: string): number {
  if (!isQuietAt(now, start, end)) return 0
  const local = shanghaiParts(now)
  const startMinute = clockMinute(start)
  const endMinute = clockMinute(end)
  let day = local.day
  if (startMinute > endMinute && local.minute >= startMinute) day += 1
  const endUtc = day * 86_400_000 + endMinute * 60_000 - 8 * 60 * 60 * 1000
  return Math.max(0, endUtc - now.getTime())
}

export function dingTalkSign(secret: string, timestamp: number): string {
  return createHmac('sha256', secret)
    .update(String(timestamp) + '\n' + secret)
    .digest('base64')
}

function bounded(value: string, limit: number): string {
  const characters = Array.from(value.trim())
  if (characters.length <= limit) return characters.join('')
  return characters.slice(0, limit).join('') + '\n\n（内容已截断）'
}

function notificationTitle(reason: DingTalkNotification['reason']): string {
  switch (reason) {
    case 'completed': return 'DSH 任务已完成'
    case 'error': return 'DSH 任务失败'
    case 'aborted': return 'DSH 任务已中止'
    case 'blocked': return 'DSH 任务被阻塞'
    case 'max-tokens': return 'DSH 任务达到令牌限制'
  }
}

export function formatNotification(message: DingTalkNotification): { title: string; text: string } {
  const title = notificationTitle(message.reason)
  const body = bounded(message.body, MAX_MESSAGE_CHARS) || '任务结束，但没有可用的回复摘要。'
  const session = message.title.trim() || message.sessionId
  return {
    title,
    text: '## ' + title + '\n\n- 会话：**' + session + '**\n- 结果：' + message.reason + '\n\n---\n\n' + body,
  }
}

function shanghaiStamp(now: Date, includeYear: boolean): string {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const month = String(local.getUTCMonth() + 1).padStart(2, '0')
  const day = String(local.getUTCDate()).padStart(2, '0')
  const hour = String(local.getUTCHours()).padStart(2, '0')
  const minute = String(local.getUTCMinutes()).padStart(2, '0')
  return (includeYear ? String(local.getUTCFullYear()) + '-' : '') + month + '-' + day + ' ' + hour + ':' + minute
}

export function formatMissedDigest(state: MissedState, now: Date): { title: string; text: string } {
  const total = state.messages.length + state.omitted
  let text = '## 免打扰期间消息汇总\n\n- 共记录 **' + total + '** 条消息\n- 汇总时间：' + shanghaiStamp(now, true) + '（Asia/Shanghai）\n'
  let rendered = 0
  for (const [index, message] of state.messages.entries()) {
    const session = message.title.trim() || message.sessionId
    const body = bounded(message.body, MAX_MESSAGE_CHARS) || '无回复摘要。'
    const section = '\n---\n\n### ' + (index + 1) + '. ' + notificationTitle(message.reason) + '\n\n' + shanghaiStamp(new Date(message.capturedAt), false) + ' · ' + session + '\n\n' + body + '\n'
    if (Array.from(text + section).length > MAX_DIGEST_CHARS) break
    text += section
    rendered++
  }
  const omitted = total - rendered
  if (omitted > 0) text += '\n---\n\n另有 **' + omitted + '** 条消息因汇总长度限制未展开。\n'
  return { title: '免打扰期间消息汇总', text }
}

class DingTalkResponseError extends Error {}

export interface DingTalkServiceOptions {
  readonly root?: string
  readonly webhookUrl?: string
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  readonly warn?: (message: string, error?: unknown) => void
  readonly platform?: NodeJS.Platform
}

export class DingTalkService {
  private readonly root: string
  private readonly settingsPath: string
  private readonly queuePath: string
  private readonly webhookUrl: string
  private readonly request: typeof fetch
  private readonly now: () => Date
  private readonly warn: (message: string, error?: unknown) => void
  private readonly platform: NodeJS.Platform
  private settings: DingTalkStoredSettings = DEFAULT_DINGTALK_SETTINGS
  private missed: MissedState = { messages: [], omitted: 0, digest: false }
  private readonly recent = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private serial: Promise<unknown> = Promise.resolve()

  constructor(options: DingTalkServiceOptions = {}) {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    this.root = options.root ?? join(dshHome, 'dsh-notify')
    this.settingsPath = join(this.root, 'settings.json')
    this.queuePath = join(this.root, 'dingtalk-missed.json')
    this.webhookUrl = options.webhookUrl ?? DEFAULT_WEBHOOK
    this.request = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
    this.warn = options.warn ?? ((message, error) => { console.warn('[dsh-notify] ' + message, error) })
    this.platform = options.platform ?? process.platform
  }

  async initialize(): Promise<void> {
    this.settings = normalizeDingTalkSettings(await this.readJson(this.settingsPath, DEFAULT_DINGTALK_SETTINGS))
    const source = objectValue(await this.readJson(this.queuePath, { messages: [], omitted: 0, digest: false }))
    if (!Array.isArray(source.messages)) throw new Error('DingTalk missed-message queue must contain a messages array')
    if (!Number.isInteger(source.omitted) || Number(source.omitted) < 0) {
      throw new Error('DingTalk missed-message omitted count cannot be negative')
    }
    if (source.messages.length > MAX_QUEUE) {
      throw new Error('DingTalk missed-message queue exceeds ' + MAX_QUEUE + ' messages')
    }
    if (!source.messages.every(isNotification)) {
      throw new Error('DingTalk missed-message queue contains an invalid message')
    }
    if (source.digest !== undefined && typeof source.digest !== 'boolean') {
      throw new Error('DingTalk pending-message digest flag must be boolean')
    }
    const messages = source.messages.filter(message => this.reasonEnabled(message.reason))
    const filtersRestrictive = !this.settings.notifyCompleted || !this.settings.notifyFailed
    this.missed = {
      messages,
      omitted: filtersRestrictive ? 0 : Number(source.omitted),
      digest: source.digest === undefined ? messages.length > 0 || Number(source.omitted) > 0 : source.digest,
    }
    if ((!this.settings.notifyMissed && this.missed.digest) || !this.hasMissed()) {
      await this.replaceMissed({ messages: [], omitted: 0, digest: false })
    } else if (messages.length !== source.messages.length || filtersRestrictive && Number(source.omitted) > 0) {
      await this.replaceMissed(this.missed)
    }
    this.scheduleFlush()
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  getSettings(): DingTalkPublicSettings {
    return publicDingTalkSettings(this.settings)
  }

  enabledFor(reason: DingTalkNotification['reason']): boolean {
    return this.configured() && this.reasonEnabled(reason)
  }

  async updateSettings(update: DingTalkSettingsUpdate): Promise<DingTalkPublicSettings> {
    return this.exclusive(async () => {
      const source = objectValue(update)
      const clearCredentials = source.clearCredentials === true
      const accessToken = typeof source.accessToken === 'string' ? source.accessToken.trim() : ''
      const signingSecret = typeof source.signingSecret === 'string' ? source.signingSecret.trim() : ''
      if ((accessToken === '') !== (signingSecret === '')) {
        throw new Error('Access Token and Signing Secret must be configured together')
      }
      const previous = this.settings
      const next = normalizeDingTalkSettings({
        ...previous,
        ...source,
        accessToken: clearCredentials ? '' : accessToken === '' ? previous.accessToken : accessToken,
        signingSecret: clearCredentials ? '' : signingSecret === '' ? previous.signingSecret : signingSecret,
      })
      const credentialsChanged = next.accessToken !== previous.accessToken
        || next.signingSecret !== previous.signingSecret
      const filtersChanged = next.notifyCompleted !== previous.notifyCompleted
        || next.notifyFailed !== previous.notifyFailed
      if (credentialsChanged) {
        await this.replaceMissed({ messages: [], omitted: 0, digest: false })
      }
      await this.saveJson(this.settingsPath, next)
      this.settings = next
      if (!credentialsChanged && !next.notifyMissed && this.missed.digest) {
        await this.replaceMissed({ messages: [], omitted: 0, digest: false })
      } else if (!credentialsChanged && filtersChanged && this.hasMissed()) {
        const messages = this.missed.messages.filter(message => this.reasonEnabled(message.reason))
        await this.replaceMissed({
          messages,
          omitted: 0,
          digest: messages.length > 0 && this.missed.digest,
        })
      }
      this.scheduleFlush()
      return publicDingTalkSettings(next)
    })
  }

  async notify(message: DingTalkNotification): Promise<'sent' | 'queued' | 'ignored' | 'duplicate'> {
    return this.exclusive(async () => {
      if (this.recent.has(message.eventId)) return 'duplicate'
      if (!this.configured() || !this.reasonEnabled(message.reason)) return 'ignored'
      const now = this.now()
      if (this.settings.quietHoursEnabled && isQuietAt(now, this.settings.quietHoursStart, this.settings.quietHoursEnd)) {
        if (this.settings.notifyMissed) {
          await this.enqueue(message, now, true)
          this.remember(message.eventId)
          this.scheduleFlush()
          return 'queued'
        }
        this.remember(message.eventId)
        return 'ignored'
      }
      await this.enqueue(message, now, false)
      this.remember(message.eventId)
      try {
        await this.flushPending(now)
        return 'sent'
      } catch (error) {
        this.scheduleFlush(60_000)
        throw error
      }
    })
  }

  async sendTest(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.configured()) throw new Error('请先配置 Access Token 和 Signing Secret')
      await this.send({
        title: 'DSH 钉钉通知测试',
        text: '## DSH 钉钉通知测试\n\ndsh-notify 的钉钉机器人配置工作正常。',
      })
    })
  }

  private configured(): boolean {
    return this.settings.accessToken !== '' && this.settings.signingSecret !== ''
  }

  private reasonEnabled(reason: DingTalkNotification['reason']): boolean {
    return reason === 'completed' ? this.settings.notifyCompleted : this.settings.notifyFailed
  }

  private hasMissed(): boolean {
    return this.missed.messages.length > 0 || this.missed.omitted > 0
  }

  private async enqueue(message: DingTalkNotification, capturedAt: Date, digest: boolean): Promise<void> {
    const messages = [...this.missed.messages]
    let omitted = this.missed.omitted
    if (messages.length < MAX_QUEUE) messages.push({ ...message, capturedAt: capturedAt.toISOString() })
    else omitted++
    await this.replaceMissed({
      messages,
      omitted,
      digest: this.hasMissed() ? this.missed.digest || digest : digest,
    })
  }

  private remember(eventId: string): void {
    this.recent.add(eventId)
    if (this.recent.size <= RECENT_EVENT_LIMIT) return
    const oldest = this.recent.values().next().value as string | undefined
    if (oldest !== undefined) this.recent.delete(oldest)
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.catch(() => undefined)
    return result
  }

  private async send(message: { title: string; text: string }): Promise<void> {
    const timestamp = this.now().getTime()
    const url = new URL(this.webhookUrl)
    url.searchParams.set('access_token', this.settings.accessToken)
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', dingTalkSign(this.settings.signingSecret, timestamp))
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: message }),
      signal: AbortSignal.timeout(15_000),
    })
    const raw = await response.text()
    if (!response.ok) throw new DingTalkResponseError('DingTalk returned HTTP ' + response.status + ': ' + raw)
    let payload: { errcode?: unknown; errmsg?: unknown }
    try {
      payload = JSON.parse(raw) as { errcode?: unknown; errmsg?: unknown }
    } catch {
      throw new DingTalkResponseError('DingTalk returned an invalid response')
    }
    if (payload.errcode !== 0) {
      throw new DingTalkResponseError(
        'DingTalk returned errcode ' + String(payload.errcode) + ': ' + String(payload.errmsg ?? 'unknown error'),
      )
    }
  }

  private async flushPending(now: Date): Promise<void> {
    if (!this.hasMissed() || !this.configured()) return
    if (this.missed.digest) {
      if (!this.settings.notifyMissed) return
      if (this.settings.quietHoursEnabled && isQuietAt(now, this.settings.quietHoursStart, this.settings.quietHoursEnd)) return
      const snapshot = this.missed
      await this.send(formatMissedDigest(snapshot, now))
      await this.replaceMissed({ messages: [], omitted: 0, digest: false })
      return
    }
    while (this.missed.messages.length > 0) {
      await this.send(formatNotification(this.missed.messages[0]!))
      await this.replaceMissed({
        messages: this.missed.messages.slice(1),
        omitted: this.missed.omitted,
        digest: false,
      })
    }
    if (this.missed.omitted > 0) {
      await this.replaceMissed({ messages: [], omitted: 0, digest: false })
    }
  }

  private scheduleFlush(retryDelay?: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.configured() || !this.hasMissed()) return
    const now = this.now()
    const delay = retryDelay ?? (this.missed.digest && this.settings.quietHoursEnabled
      ? millisecondsUntilQuietEnd(now, this.settings.quietHoursStart, this.settings.quietHoursEnd)
      : 0)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.exclusive(async () => { await this.flushPending(this.now()) }).catch(error => {
        this.warn('could not send DingTalk do-not-disturb summary', error)
        this.scheduleFlush(60_000)
      })
    }, Math.min(delay, 2_147_483_647))
  }

  private async replaceMissed(state: MissedState): Promise<void> {
    if (state.messages.length === 0 && state.omitted === 0) await rm(this.queuePath, { force: true })
    else await this.saveJson(this.queuePath, state)
    this.missed = state
  }

  private async readJson(path: string, fallback: unknown): Promise<unknown> {
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(path + ' must be a regular file')
      if (this.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        throw new Error(path + ' must use permissions 0600')
      }
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw error
    }
  }

  private async saveJson(path: string, value: unknown): Promise<void> {
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(directory + ' must be a regular directory')
    if (this.platform !== 'win32') await chmod(directory, 0o700)
    const temp = join(directory, '.' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.tmp')
    try {
      const handle = await open(temp, 'w', 0o600)
      try {
        await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
  }
}

function isNotification(value: unknown): value is MissedMessage {
  const source = objectValue(value)
  return typeof source.eventId === 'string' && source.eventId !== ''
    && typeof source.sessionId === 'string' && source.sessionId !== ''
    && Number.isSafeInteger(source.turn) && Number(source.turn) >= 0
    && typeof source.title === 'string'
    && typeof source.body === 'string'
    && typeof source.capturedAt === 'string'
    && Number.isFinite(Date.parse(source.capturedAt))
    && ['completed', 'error', 'aborted', 'blocked', 'max-tokens'].includes(String(source.reason))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += data.length
    if (total > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(data)
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function loopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') return true
  const match = /^(?:\[?::ffff:)?(\d{1,3})(?:\.(\d{1,3})){3}\]?$/.exec(normalized)
  if (match === null) return false
  const address = normalized.replace(/^\[?::ffff:/, '').replace(/\]?$/, '')
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && octets[0] === 127
}

export function trustedDingTalkRequest(req: Pick<IncomingMessage, 'headers' | 'socket' | 'method'>): boolean {
  const remote = req.socket.remoteAddress
  if (remote === undefined || !loopbackHost(remote)) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (!loopbackHost(hostUrl.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    try { if (new URL(origin).host !== hostUrl.host) return false } catch { return false }
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    if (req.headers['sec-fetch-site'] !== 'same-origin' || typeof origin !== 'string') return false
    const contentType = req.headers['content-type']
    if (typeof contentType !== 'string' || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return false
  }
  return true
}

function readSettingsUpdate(value: unknown): DingTalkSettingsUpdate {
  const source = objectValue(value)
  return {
    accessToken: typeof source.accessToken === 'string' ? source.accessToken : undefined,
    signingSecret: typeof source.signingSecret === 'string' ? source.signingSecret : undefined,
    clearCredentials: source.clearCredentials === true,
    notifyCompleted: bool(source.notifyCompleted, true),
    notifyFailed: bool(source.notifyFailed, true),
    quietHoursEnabled: bool(source.quietHoursEnabled, false),
    quietHoursStart: parseClock(source.quietHoursStart),
    quietHoursEnd: parseClock(source.quietHoursEnd),
    notifyMissed: bool(source.notifyMissed, DEFAULT_DINGTALK_SETTINGS.notifyMissed),
  }
}

export function createDingTalkRoute(service: DingTalkService): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!trustedDingTalkRequest(req)) {
      json(res, 403, { error: 'forbidden' })
      return
    }
    try {
      switch (req.method) {
        case 'GET':
          json(res, 200, service.getSettings())
          return
        case 'PUT':
          json(res, 200, await service.updateSettings(readSettingsUpdate(await readBody(req))))
          return
        case 'POST': {
          const body = objectValue(await readBody(req))
          if (body.action === 'test') {
            await service.sendTest()
            json(res, 200, { ok: true })
            return
          }
          throw new Error('invalid DingTalk action')
        }
        default:
          res.writeHead(405, { allow: 'GET, PUT, POST' })
          res.end()
      }
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
