import { readFile, rm, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { transform } from 'lightningcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const id = manifest.name
const outdir = join(root, 'lib')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.19',
  packages: 'external',
  sourcemap: true,
  sourcesContent: false,
})

const cssModules = {
  name: 'dsh-delegate-agent-css-modules',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
      const source = await readFile(path)
      const compiled = transform({
        filename: path,
        code: source,
        cssModules: { pattern: 'dshDelegate_[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(
        Object.entries(compiled.exports ?? {}).map(([local, value]) => [local, value.name]),
      )
      const tagId = `${id}/${basename(path)}`
      return {
        contents: [
          `const css = ${JSON.stringify(compiled.code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
          "  const tag = document.createElement('style');",
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classes)};`,
        ].join('\n'),
        loader: 'js',
      }
    })
  },
}

await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(outdir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  sourcemap: true,
  sourcesContent: false,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-locale/client',
    '@deepseek-ai/dsh-client-ui-conversation/client',
    '@deepseek-ai/dsh-client-connection/client',
  ],
  plugins: [cssModules],
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.MODE': '"production"',
    'import.meta.env': '{"MODE":"production"}',
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

console.log(`built ${id} Host and Client artifacts`)
