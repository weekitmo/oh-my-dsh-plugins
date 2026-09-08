/** Host half of the independent DSH Web terminal plugin. */
import { TerminalManager, type HostConnectionLike, type TerminalManagerOptions, type WebServerLike } from './host/terminal-manager.ts'

export type { HostConnectionLike, TerminalManagerOptions, WebServerLike }
export { TerminalManager } from './host/terminal-manager.ts'
export * from './core/index.ts'

export const name = '@weekit/dsh-keybinding'
export const inject = ['webServer', 'connection']

export interface Config extends TerminalManagerOptions {
  enabled?: boolean
}

export interface HostPluginContext {
  inject(services: readonly string[], callback: (ctx: HostPluginContext) => void): void
  get<T>(service: string): T
  effect(setup: () => (() => void | Promise<void>), name?: string): unknown
}

export function apply(ctx: HostPluginContext, config: Config = {}): void {
  if (config.enabled === false) return
  const manager = new TerminalManager(config)
  ctx.inject(['webServer', 'connection'], (hostCtx) => {
    const webServer = hostCtx.get<WebServerLike>('webServer')
    const connection = hostCtx.get<HostConnectionLike>('connection')
    hostCtx.effect(() => {
      const dispose = manager.register(webServer, connection)
      return () => { void dispose() }
    }, 'dsh-keybinding: websocket')
  })
  ctx.effect(() => () => manager.dispose(), 'dsh-keybinding: manager')
}
