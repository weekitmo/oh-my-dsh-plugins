import type { DingTalkPublicSettings, DingTalkSettingsUpdate } from '../contract.ts'

const ENDPOINT = '/api/dsh-notify/dingtalk'

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({})) as { error?: unknown } & T
  if (!response.ok) {
    throw new Error(typeof value.error === 'string' ? value.error : `Request failed (HTTP ${response.status})`)
  }
  return value
}

export async function loadDingTalkSettings(): Promise<DingTalkPublicSettings> {
  return responseJson<DingTalkPublicSettings>(await fetch(ENDPOINT, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }))
}

export async function saveDingTalkSettings(update: DingTalkSettingsUpdate): Promise<DingTalkPublicSettings> {
  return responseJson<DingTalkPublicSettings>(await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  }))
}

export async function sendDingTalkTest(): Promise<void> {
  await responseJson<{ ok: true }>(await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'test' }),
  }))
}
