import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { SOUND_SOURCES, SoundPlayer, validSoundVolume } from '../src/client/sounds.ts'

interface FakeElement {
  volume: number
  currentTime: number
  played: number
  play(): Promise<void>
}

function fakePlayer(options: {
  readonly reject?: boolean
  readonly missing?: boolean
} = {}): { player: SoundPlayer; created: string[]; elements: FakeElement[]; warnings: string[] } {
  const created: string[] = []
  const elements: FakeElement[] = []
  const warnings: string[] = []
  const player = new SoundPlayer({
    create: (source) => {
      if (options.missing === true) return undefined
      created.push(source)
      const element: FakeElement = {
        volume: 1,
        currentTime: 3,
        played: 0,
        play() {
          element.played += 1
          return options.reject === true ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
        },
      }
      elements.push(element)
      return element as unknown as HTMLAudioElement
    },
    warn: message => { warnings.push(message) },
  })
  return { player, created, elements, warnings }
}

describe('result sounds', () => {
  it('maps every attention outcome to a bundled clip source', () => {
    expect(Object.keys(SOUND_SOURCES).sort()).toEqual(
      ['aborted', 'approval', 'blocked', 'completed', 'error', 'max-tokens'],
    )
    for (const source of Object.values(SOUND_SOURCES)) {
      expect(typeof source).toBe('string')
      expect(source.length).toBeGreaterThan(0)
    }
  })

  const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
  it.skipIf(!existsSync(bundlePath))('inlines every clip into the client bundle', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    const embedded = bundle.match(/data:audio\/ogg;base64,/gu) ?? []
    expect(embedded.length).toBeGreaterThanOrEqual(Object.keys(SOUND_SOURCES).length)
    expect(bundle).toContain('dsh_notify_soundList')
  })

  it('plays each outcome from the start at the configured volume', () => {
    const { player, elements } = fakePlayer()
    player.play('completed', 60)
    player.play('completed', 60)
    player.play('approval', 25)

    expect(elements).toHaveLength(2)
    const [completed, approval] = elements
    expect(completed?.played).toBe(2)
    expect(completed?.currentTime).toBe(0)
    expect(completed?.volume).toBeCloseTo(0.6)
    expect(approval?.played).toBe(1)
    expect(approval?.volume).toBeCloseTo(0.25)
  })

  it('clamps out-of-range volumes into the media element range', () => {
    const { player, elements } = fakePlayer()
    player.play('error', 400)
    const loud = elements[0]?.volume
    player.play('error', -20)
    expect(loud).toBe(1)
    expect(elements[0]?.volume).toBe(0)
  })

  it('swallows blocked playback and missing audio support', async () => {
    const rejected = fakePlayer({ reject: true })
    rejected.player.play('completed', 50)
    await Promise.resolve()
    await Promise.resolve()
    expect(rejected.warnings).toEqual(['[dsh-notify] sound playback was blocked by the browser'])

    const missing = fakePlayer({ missing: true })
    expect(() => { missing.player.play('completed', 50) }).not.toThrow()
    expect(missing.created).toEqual([])
    expect(missing.warnings).toEqual([])
  })

  it('keeps one element per outcome until disposal', () => {
    const { player, created } = fakePlayer()
    player.play('completed', 50)
    player.play('completed', 50)
    expect(created).toEqual([SOUND_SOURCES.completed])
    player.dispose()
    player.play('completed', 50)
    expect(created).toEqual([SOUND_SOURCES.completed, SOUND_SOURCES.completed])
  })

  it('reports a construction failure instead of throwing', () => {
    const warn = vi.fn()
    const player = new SoundPlayer({
      create: () => { throw new Error('no audio device') },
      warn,
    })
    expect(() => { player.play('aborted', 50) }).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[dsh-notify] sound element could not be created', expect.any(Error))
  })

  it('accepts only integer volumes inside 0–100', () => {
    expect(validSoundVolume(0)).toBe(true)
    expect(validSoundVolume(100)).toBe(true)
    expect(validSoundVolume(60.5)).toBe(false)
    expect(validSoundVolume(101)).toBe(false)
    expect(validSoundVolume(-1)).toBe(false)
    expect(validSoundVolume('60')).toBe(false)
    expect(validSoundVolume(undefined)).toBe(false)
  })
})
