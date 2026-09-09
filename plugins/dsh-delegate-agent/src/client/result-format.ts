export type ResultFormat = 'json' | 'markdown'

export function resultFormat(text: string): ResultFormat {
  const candidate = text.trim()
  if (candidate === '') return 'markdown'
  try {
    JSON.parse(candidate)
    return 'json'
  } catch {
    return 'markdown'
  }
}

export interface ParsedOutputLine {
  readonly raw: string
  readonly summary: string
  readonly parsed?: object | unknown[]
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function lineSummary(value: object | unknown[], index: number): string {
  const row = object(value)
  const update = object(row?.['update'])
  for (const candidate of [row?.['type'], row?.['event'], update?.['sessionUpdate'], update?.['type']]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return Array.isArray(value) ? `array[${String(value.length)}]` : `event ${String(index + 1)}`
}

export function parseOutputLines(text: string): ParsedOutputLine[] {
  return outputLines(text).map((raw, index) => {
    try {
      const value = JSON.parse(raw) as unknown
      if (typeof value === 'object' && value !== null) {
        const parsed = value as object | unknown[]
        return { raw, parsed, summary: lineSummary(parsed, index) }
      }
    } catch {}
    return { raw, summary: `line ${String(index + 1)}` }
  })
}

export function outputLines(text: string): string[] {
  if (text === '') return []
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}
