/**
 * Result sounds: one short CC0 clip per outcome, inlined into the client bundle
 * at build time (`esbuild --loader:.ogg=dataurl`) so playback never depends on
 * an extra route, a network fetch, or the plugin's asset directory at runtime.
 *
 * Master switch and volume live in the notification settings; every fault is
 * swallowed — audio is a nicety and must never break a notification surface.
 */
import type { AttentionReason } from '../contract.ts'
import blockedUrl from '../../assets/sounds/bong_001.ogg'
import abortedUrl from '../../assets/sounds/close_002.ogg'
import completedUrl from '../../assets/sounds/confirmation_001.ogg'
import errorUrl from '../../assets/sounds/error_001.ogg'
import maxTokensUrl from '../../assets/sounds/pluck_001.ogg'
import approvalUrl from '../../assets/sounds/question_002.ogg'

export const DEFAULT_SOUND_VOLUME = 60
export const MIN_SOUND_VOLUME = 0
export const MAX_SOUND_VOLUME = 100

export const SOUND_SOURCES: Readonly<Record<AttentionReason, string>> = {
  approval: approvalUrl,
  completed: completedUrl,
  error: errorUrl,
  aborted: abortedUrl,
  blocked: blockedUrl,
  'max-tokens': maxTokensUrl,
}

export function validSoundVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_SOUND_VOLUME && value <= MAX_SOUND_VOLUME
}

/** Minimal playback face accepted from the page (`HTMLAudioElement` satisfies it). */
export interface SoundElement {
  volume: number
  currentTime: number
  play(): Promise<void>
}

export interface SoundPlayerOptions {
  /** Element factory; absent when the page has no audio support (tests, headless). */
  readonly create?: (source: string) => SoundElement | undefined
  readonly warn?: (message: string, error: unknown) => void
}

function defaultCreate(source: string): SoundElement | undefined {
  if (typeof Audio === 'undefined') return undefined
  return new Audio(source)
}

/**
 * One lazily built audio element per outcome, re-triggered from the start so a
 * burst of results never silently overlaps mid-clip.
 */
export class SoundPlayer {
  private readonly elements = new Map<AttentionReason, SoundElement | undefined>()
  private readonly create: (source: string) => SoundElement | undefined
  private readonly warn: (message: string, error: unknown) => void

  constructor(options: SoundPlayerOptions = {}) {
    this.create = options.create ?? defaultCreate
    this.warn = options.warn ?? ((message, error) => { console.warn(message, error) })
  }

  /**
   * Play one outcome's clip.
   * @param reason - outcome selecting the clip.
   * @param volumePercent - playback volume in percent; clamped into range.
   */
  play(reason: AttentionReason, volumePercent: number): void {
    const element = this.element(reason)
    if (element === undefined) return
    try {
      element.volume = Math.min(1, Math.max(0, volumePercent / 100))
      element.currentTime = 0
      void Promise.resolve(element.play()).catch(error => {
        this.warn('[dsh-notify] sound playback was blocked by the browser', error)
      })
    } catch (error) {
      this.warn('[dsh-notify] sound playback failed', error)
    }
  }

  /** Drop every cached element; the next play() rebuilds what it needs. */
  dispose(): void {
    this.elements.clear()
  }

  private element(reason: AttentionReason): SoundElement | undefined {
    if (this.elements.has(reason)) return this.elements.get(reason)
    let element: SoundElement | undefined
    try {
      element = this.create(SOUND_SOURCES[reason])
    } catch (error) {
      this.warn('[dsh-notify] sound element could not be created', error)
      element = undefined
    }
    this.elements.set(reason, element)
    return element
  }
}
