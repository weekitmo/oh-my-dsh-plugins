/** Creates the private `ws` helper injected into the keybinding plugin's terminal shell. */
import { chmodSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export class WorkspaceCommandDir {
  readonly path: string

  constructor() {
    this.path = join(tmpdir(), `dsh-keybinding-${process.pid}`)
    mkdirSync(this.path, { recursive: true, mode: 0o700 })
    const script = join(this.path, 'ws')
    writeFileSync(script, [
      '#!/bin/sh',
      'set -eu',
      'mode=add',
      'if [ "${1-}" = "--open" ] && [ "$#" -eq 1 ]; then mode=open',
      'elif [ "$#" -ne 0 ]; then printf "usage: ws [--open]\\n" >&2; exit 2',
      'fi',
      'cwd=$(pwd -P)',
      'encoded=$(printf "%s" "$cwd" | base64 | tr -d "\\n")',
      'printf "\\033]777;dsh-workspace;%s;b64:%s\\007" "$mode" "$encoded"',
    ].join('\n') + '\n', { mode: 0o700 })
    chmodSync(script, 0o700)
  }

  prepend(pathValue: string | undefined): string {
    return [this.path, pathValue ?? ''].filter(Boolean).join(':')
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true })
  }
}
