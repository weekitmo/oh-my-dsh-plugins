import type { AdapterId, PermissionMode } from '../types.ts'

export interface InvocationInput {
  readonly adapterId: AdapterId
  readonly executable: string
  readonly prompt: string
  readonly cwd: string
  readonly model?: string
  readonly provider?: string
  readonly reasoning?: string
  readonly permissionMode: PermissionMode
}

export interface Invocation {
  readonly argv: readonly string[]
  readonly parser: AdapterId
}

function appendOption(argv: string[], option: string, value: string | undefined): void {
  if (value !== undefined && value.trim() !== '') argv.push(option, value)
}

export function buildInvocation(input: InvocationInput): Invocation {
  switch (input.adapterId) {
    case 'pi': {
      const argv = [input.executable, '--mode', 'json', '--print', '--no-session', '--no-approve']
      appendOption(argv, '--provider', input.provider)
      appendOption(argv, '--model', input.model)
      appendOption(argv, '--thinking', input.reasoning)
      if (input.permissionMode === 'read-only') argv.push('--tools', 'read,grep,find,ls')
      argv.push('--', input.prompt)
      return { argv, parser: 'pi' }
    }
    case 'codex': {
      if (input.provider !== undefined) throw new Error('Codex does not support a provider override; use a Codex profile outside this plugin')
      if (input.reasoning !== undefined) throw new Error('Codex reasoning overrides are not exposed by this plugin')
      const argv = [
        input.executable,
        'exec',
        '--json',
        '--color',
        'never',
        '-C',
        input.cwd,
        '--sandbox',
        input.permissionMode,
        '--ephemeral',
      ]
      appendOption(argv, '--model', input.model)
      argv.push(input.prompt)
      return { argv, parser: 'codex' }
    }
    case 'grok': {
      if (input.provider !== undefined) throw new Error('Grok does not support a separate provider override')
      const argv = [
        input.executable,
        '--output-format',
        'streaming-json',
        '--cwd',
        input.cwd,
        '--permission-mode',
        input.permissionMode === 'read-only' ? 'plan' : 'acceptEdits',
      ]
      appendOption(argv, '--model', input.model)
      appendOption(argv, '--reasoning-effort', input.reasoning)
      argv.push('-p', input.prompt)
      return { argv, parser: 'grok' }
    }
  }
}

export function commandPreview(argv: readonly string[]): readonly string[] {
  if (argv.length === 0) return []
  const copy = [...argv]
  const promptIndex = copy[1] === 'exec'
    ? copy.length - 1
    : copy.includes('-p')
      ? copy.indexOf('-p') + 1
      : copy.indexOf('--') + 1
  if (promptIndex > 0 && promptIndex < copy.length) copy[promptIndex] = '<prompt>'
  return copy
}
