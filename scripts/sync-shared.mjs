// Mirror shared/ into the reader app, before every dev and build.
//
// WHY A SYNC RATHER THAN AN IMPORT
// The reader app pins its Turbopack root to reader/ (without that, Next infers
// the Loom repo as the workspace root and compiles Loom's own src/ — the first
// run pulled in instrumentation.ts and tried to start the backup and narration
// schedulers inside the reader process). With the root pinned, anything outside
// reader/ is unreachable: a symlink resolves for CSS but Turbopack rejects it
// for modules — "points out of the filesystem root".
//
// So the files are copied. The copy is GENERATED, never edited: it is
// regenerated on every `dev` and `build`, and it is gitignored, so it cannot
// drift the way a hand-copy would. shared/ stays the only source of truth.
//
// The alternative was a `file:` dependency plus transpilePackages, which works
// but adds package machinery to a repo that deliberately has no workspaces.

import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'shared')
const DEST = path.join(root, 'reader', 'src', 'shared')

const BANNER = (name) => `/* GENERATED — do not edit.
 * Copied from shared/${name} by scripts/sync-shared.mjs on every dev/build.
 * Edit the original; this copy is overwritten and is gitignored.
 */
`

rmSync(DEST, { recursive: true, force: true })
mkdirSync(DEST, { recursive: true })
cpSync(SRC, DEST, { recursive: true })

// Stamp text sources so anyone who opens the copy is told where to edit.
for (const name of readdirSync(DEST)) {
  const full = path.join(DEST, name)
  if (!statSync(full).isFile()) continue
  if (!/\.(ts|tsx|css)$/.test(name)) continue
  writeFileSync(full, BANNER(name) + readFileSync(full, 'utf8'))
}

console.log(`• synced shared/ -> reader/src/shared (${readdirSync(DEST).length} entries)`)
