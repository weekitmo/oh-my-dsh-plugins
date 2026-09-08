import { describe, expect, it } from 'vitest'
import { parseClientFrame, parseWorkspaceAction } from '../src/core/protocol.ts'
import { Transcript, WorkspaceFrameFilter } from '../src/core/transcript.ts'

const frame = (mode: 'add' | 'open', cwd: string): string =>
  `\u001b]777;dsh-workspace;${mode};${encodeURIComponent(cwd)}\u0007`

describe('terminal protocol', () => {
  it('validates client frames and rejects unsafe terminal ids', () => {
    expect(parseClientFrame(JSON.stringify({ type: 'resize', cols: 80, rows: 24 })))
      .toEqual({ type: 'resize', cols: 80, rows: 24 })
    expect(parseClientFrame(JSON.stringify({ type: 'open', terminalId: '../shell' }))).toBeUndefined()
    expect(parseClientFrame('{bad json')).toBeUndefined()
  })

  it('extracts workspace actions without exposing private OSC data', () => {
    expect(parseWorkspaceAction(`before${frame('open', '/tmp/工作区')}after`)).toEqual({
      visible: 'beforeafter', action: { action: 'open', cwd: '/tmp/工作区' },
    })
  })

  it('handles a workspace frame split across PTY chunks', () => {
    const filter = new WorkspaceFrameFilter()
    const complete = frame('add', '/repo')
    expect(filter.consume(`prompt ${complete.slice(0, 12)}`)).toEqual({ visible: 'prompt ', actions: [] })
    expect(filter.consume(complete.slice(12) + 'done')).toEqual({
      visible: 'done', actions: [{ action: 'add', cwd: '/repo' }],
    })
  })

  it('bounds transcript output by UTF-8 bytes and strips complete actions', () => {
    const transcript = new Transcript(5)
    transcript.append('ab')
    transcript.append(frame('add', '/repo'))
    transcript.append('界面')
    expect(transcript.snapshot()).toEqual({ data: '面', truncated: true })
  })
})
