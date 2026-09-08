import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pluginsDir = join(root, 'plugins')
const entries = await readdir(pluginsDir, { withFileTypes: true })

for (const entry of entries) {
  if (!entry.isDirectory()) continue

  const pluginDir = join(pluginsDir, entry.name)
  await Promise.all([
    rm(join(pluginDir, 'lib'), { recursive: true, force: true }),
    rm(join(pluginDir, 'dist'), { recursive: true, force: true }),
  ])

  const files = await readdir(pluginDir)
  await Promise.all(
    files
      .filter((file) => file.endsWith('.tsbuildinfo'))
      .map((file) => rm(join(pluginDir, file), { force: true })),
  )
}
