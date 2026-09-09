import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DelegatePreset, DelegatePresetInput } from '../types.ts'

export const MAX_PRESETS_PER_WORKSPACE = 50

export class PresetConflictError extends Error {}
export class PresetLimitError extends Error {}

function clonePreset(preset: DelegatePreset): DelegatePreset {
  return structuredClone(preset)
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US')
}

export class DelegatePresetStore {
  private readonly presets = new Map<string, DelegatePreset>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    try {
      const decoded = JSON.parse(await readFile(this.path(), 'utf8')) as unknown
      if (!Array.isArray(decoded)) throw new Error('preset store root must be an array')
      for (const value of decoded) {
        if (typeof value !== 'object' || value === null) continue
        const preset = value as DelegatePreset
        if (typeof preset.id !== 'string' || typeof preset.workspaceId !== 'string' || typeof preset.name !== 'string') continue
        this.presets.set(preset.id, clonePreset(preset))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  list(workspaceId: string): DelegatePreset[] {
    return [...this.presets.values()]
      .filter(preset => preset.workspaceId === workspaceId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(clonePreset)
  }

  get(id: string, workspaceId: string): DelegatePreset | undefined {
    const preset = this.presets.get(id)
    return preset?.workspaceId === workspaceId ? clonePreset(preset) : undefined
  }

  async create(workspaceId: string, input: DelegatePresetInput): Promise<DelegatePreset> {
    const existing = this.list(workspaceId)
    if (existing.length >= MAX_PRESETS_PER_WORKSPACE) {
      throw new PresetLimitError(`workspace preset limit reached (${String(MAX_PRESETS_PER_WORKSPACE)})`)
    }
    this.assertNameAvailable(workspaceId, input.name)
    const now = Date.now()
    const preset: DelegatePreset = {
      id: `preset-${randomUUID()}`,
      workspaceId,
      ...input,
      name: input.name.trim(),
      fixedInstructions: input.fixedInstructions.trim(),
      createdAt: now,
      updatedAt: now,
    }
    this.presets.set(preset.id, clonePreset(preset))
    try {
      await this.persist()
    } catch (error) {
      this.presets.delete(preset.id)
      throw error
    }
    return clonePreset(preset)
  }

  async update(id: string, workspaceId: string, input: DelegatePresetInput): Promise<DelegatePreset | undefined> {
    const current = this.presets.get(id)
    if (current?.workspaceId !== workspaceId) return undefined
    this.assertNameAvailable(workspaceId, input.name, id)
    const preset: DelegatePreset = {
      ...current,
      ...input,
      name: input.name.trim(),
      fixedInstructions: input.fixedInstructions.trim(),
      updatedAt: Date.now(),
    }
    this.presets.set(id, clonePreset(preset))
    try {
      await this.persist()
    } catch (error) {
      this.presets.set(id, current)
      throw error
    }
    return clonePreset(preset)
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const current = this.presets.get(id)
    if (current?.workspaceId !== workspaceId) return false
    this.presets.delete(id)
    try {
      await this.persist()
    } catch (error) {
      this.presets.set(id, current)
      throw error
    }
    return true
  }

  async close(): Promise<void> {
    await this.persist()
    await this.writeChain
  }

  private assertNameAvailable(workspaceId: string, name: string, exceptId?: string): void {
    const candidate = normalizedName(name)
    if ([...this.presets.values()].some(preset => (
      preset.workspaceId === workspaceId
      && preset.id !== exceptId
      && normalizedName(preset.name) === candidate
    ))) throw new PresetConflictError('a preset with this name already exists in the workspace')
  }

  private path(): string {
    return join(this.directory, 'presets.json')
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify([...this.presets.values()], null, 2)
    const write = this.writeChain.then(async () => {
      const temporary = join(this.directory, `.presets-${randomUUID()}.tmp`)
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
      try {
        await rename(temporary, this.path())
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.writeChain = write.catch(() => {})
    await write
  }
}
