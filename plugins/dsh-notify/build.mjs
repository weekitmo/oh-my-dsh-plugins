import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const clientId = '@weekit/dsh-notify'

/**
 * Inline result-sound clips as `data:audio/ogg` URLs. esbuild's own `dataurl`
 * loader labels Ogg files `application/ogg`, which audio elements do not always
 * decode from a data URL, so the MIME type is set here explicitly.
 */
const inlineOggAudio = {
  name: 'inline-ogg-audio',
  setup(build) {
    build.onResolve({ filter: /\.ogg$/ }, args => ({
      path: args.path.startsWith('.') ? resolve(dirname(args.importer), args.path) : args.path,
      namespace: 'ogg-inline',
    }))
    build.onLoad({ filter: /.*/, namespace: 'ogg-inline' }, args => ({
      contents: `export default ${JSON.stringify(`data:audio/ogg;base64,${readFileSync(args.path).toString('base64')}`)}`,
      loader: 'js',
    }))
  },
}

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/invariant.ts'],
  outfile: 'lib/invariant.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  // Result sounds ship inside the bundle: no extra route, no runtime fetch.
  plugins: [inlineOggAudio],
  external: [...dshExternal, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientId)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

execFileSync('node_modules/.bin/tsc', ['-p', 'tsconfig.json'], { stdio: 'inherit' })
