/** Host-side discovery and validation of terminal-suitable system fonts. */
import { createHash } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { extname, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import * as fontkit from 'fontkit'
import type { Font, FontCollection } from 'fontkit'

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])
const MAX_FONT_FILE_BYTES = 64 * 1024 * 1024
const MAX_DISCOVERED_FILES = 2_000
const MONOSPACE_SAMPLE = [...' iIlMW0@#']

export interface TerminalFontSource {
  id: string
  family: string
  path: string
}

export interface TerminalFontCatalogOptions {
  configured?: { family: string; path: string }
  discoverSystemFonts?: boolean
  directories?: readonly string[]
}

export interface TerminalFontCatalogLike {
  list(): Promise<readonly TerminalFontSource[]>
  get(id: string): Promise<TerminalFontSource | undefined>
}

interface DiscoveredTerminalFont extends TerminalFontSource {
  faceRank: number
  familyRank: number
}

export class TerminalFontCatalog implements TerminalFontCatalogLike {
  private readonly options: TerminalFontCatalogOptions
  private sources: Promise<readonly TerminalFontSource[]> | undefined

  constructor(options: TerminalFontCatalogOptions = {}) {
    this.options = options
  }

  list(): Promise<readonly TerminalFontSource[]> {
    this.sources ??= discoverTerminalFonts(this.options)
    return this.sources
  }

  async get(id: string): Promise<TerminalFontSource | undefined> {
    return (await this.list()).find(source => source.id === id)
  }
}

export async function discoverTerminalFonts(options: TerminalFontCatalogOptions = {}): Promise<readonly TerminalFontSource[]> {
  const configured = normalizeConfiguredFont(options.configured)
  const sources = configured === undefined ? [] : [configured]
  if (options.discoverSystemFonts === false) return sources

  const files = await findFontFiles(options.directories ?? systemFontDirectories())
  const discovered = await inspectFiles(files)
  const bestByFamily = new Map<string, DiscoveredTerminalFont>()
  for (const source of discovered) {
    const key = source.family.toLocaleLowerCase()
    const current = bestByFamily.get(key)
    if (current === undefined || compareSource(source, current) < 0) bestByFamily.set(key, source)
  }
  const seen = new Set(sources.map(source => source.family.toLocaleLowerCase()))
  const ranked = [...bestByFamily.values()].sort((left, right) => left.familyRank - right.familyRank || left.family.localeCompare(right.family))
  for (const { faceRank: _faceRank, familyRank: _familyRank, ...source } of ranked) {
    const key = source.family.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(source)
  }
  return sources
}

export function isTerminalMonospaceFont(font: Font): boolean {
  const family = preferredFamily(font)
  if (family.length === 0 || family.startsWith('.')) return false
  if (font['OS/2']?.fsType.noEmbedding || font['OS/2']?.fsType.bitmapOnly) return false
  const fixedPitch = (font as Font & { post?: { isFixedPitch?: number } }).post?.isFixedPitch
  const panoseMonospace = font['OS/2']?.panose?.[3] === 9
  if (!fixedPitch && !panoseMonospace) return false
  if (!MONOSPACE_SAMPLE.every(character => font.hasGlyphForCodePoint(character.codePointAt(0) as number))) return false
  const widths = MONOSPACE_SAMPLE.map(character => font.glyphForCodePoint(character.codePointAt(0) as number).advanceWidth)
  return widths.every(width => width > 0 && width === widths[0])
}

function normalizeConfiguredFont(value: TerminalFontCatalogOptions['configured']): TerminalFontSource | undefined {
  if (value === undefined) return undefined
  const family = value.family.trim()
  const path = value.path.trim()
  if (family.length === 0 || path.length === 0) return undefined
  return { id: fontId(path, family), family, path }
}

async function inspectFiles(files: readonly string[]): Promise<DiscoveredTerminalFont[]> {
  const sources: DiscoveredTerminalFont[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
    while (cursor < files.length) {
      const path = files[cursor]
      cursor += 1
      if (path === undefined) continue
      const source = await inspectFile(path)
      if (source !== undefined) sources.push(source)
    }
  })
  await Promise.all(workers)
  return sources
}

async function inspectFile(path: string): Promise<DiscoveredTerminalFont | undefined> {
  try {
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size > MAX_FONT_FILE_BYTES) return undefined
    const opened = await fontkit.open(path)
    const faces = isCollection(opened) ? opened.fonts : [opened]
    const font = faces.filter(isTerminalMonospaceFont).sort((left, right) => regularScore(left) - regularScore(right))[0]
    if (font === undefined) return undefined
    const family = preferredFamily(font)
    return {
      id: fontId(path, font.postscriptName || family),
      family,
      path,
      faceRank: regularScore(font),
      familyRank: terminalFamilyScore(family, path),
    }
  } catch {
    return undefined
  }
}

function isCollection(value: Font | FontCollection): value is FontCollection {
  return 'fonts' in value
}

function preferredFamily(font: Font): string {
  return (font.getName('preferredFamily', 'en') ?? font.familyName ?? '').trim()
}

function regularScore(font: Font): number {
  const style = (font.getName('preferredSubfamily', 'en') ?? font.subfamilyName).toLocaleLowerCase()
  if (style === 'regular' || style === 'book' || style === 'roman') return 0
  if (!style.includes('bold') && !style.includes('italic') && !style.includes('oblique')) return 1
  return 2
}

function terminalFamilyScore(family: string, path: string): number {
  if (/nerd font mono|\bnfm\b|\bmono\b.*\bnf\b|\bnf\b.*\bmono\b/i.test(family)) return 0
  if (/nerd font|\bnf\b/i.test(family)) return 1
  if (path.startsWith(homedir())) return 2
  if (/mono|code|console|menlo|monaco/i.test(family)) return 3
  return 4
}

function compareSource(left: DiscoveredTerminalFont, right: DiscoveredTerminalFont): number {
  return left.faceRank - right.faceRank || left.familyRank - right.familyRank || left.path.localeCompare(right.path)
}

async function findFontFiles(directories: readonly string[]): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_DISCOVERED_FILES) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async entry => {
      if (files.length >= MAX_DISCOVERED_FILES) return
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if ((entry.isFile() || entry.isSymbolicLink()) && FONT_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) files.push(path)
    }))
  }
  await Promise.all(directories.map(visit))
  return [...new Set(files)]
}

function systemFontDirectories(): readonly string[] {
  const home = homedir()
  if (platform() === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library/Fonts')]
  if (platform() === 'win32') {
    return [join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), join(process.env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'Microsoft/Windows/Fonts')]
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.fonts'), join(home, '.local/share/fonts')]
}

function fontId(path: string, face: string): string {
  return createHash('sha256').update(path).update('\0').update(face).digest('hex').slice(0, 20)
}
