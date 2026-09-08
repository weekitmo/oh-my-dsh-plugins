import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
const cssPrefix = '\0dsh-keybinding-css:'
const cssSuffix = ':inline-js'

const clientId = '@weekit/dsh-keybinding'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', core: 'src/core/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
  },
  {
    name: `${clientId}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    plugins: [{
      name: 'dsh-keybinding-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const file = source.startsWith('.')
          ? resolve(importer === undefined ? process.cwd() : dirname(importer), source)
          : require.resolve(source)
        return `${cssPrefix}${file}${cssSuffix}`
      },
      async load(id: string) {
        if (!id.startsWith(cssPrefix) || !id.endsWith(cssSuffix)) return null
        const file = id.slice(cssPrefix.length, -cssSuffix.length)
        const css = await readFile(file, 'utf8')
        return `if (!document.querySelector('style[data-plugin="${clientId}"][data-css="xterm"]')) { const style = document.createElement('style'); style.dataset.plugin = ${JSON.stringify(clientId)}; style.dataset.css = 'xterm'; style.textContent = ${JSON.stringify(css)}; document.head.append(style); } export default '';`
      },
    }],
    deps: {
      neverBundle: (specifier: string) => ['react', 'react/jsx-runtime', 'react-dom'].includes(specifier),
      alwaysBundle: (specifier: string) => !['react', 'react/jsx-runtime', 'react-dom'].includes(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
