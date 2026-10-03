#!/usr/bin/env node
// Builds one book's EPUB from Loom's manuscript. Called per book by
// ops/generate_ebook.sh; see src/lib/ebook/buildEpub.ts for what it does and
// why it is safe to run against the live dev.db (read-only, one short read).
//
//   node scripts/build-ebook.mjs --title "Faded" --out ~/Writing/Ebooks/Faded.epub \
//        --author "B.C. Stryker" [--cover cover.jpg] [--if-changed] [--state-dir DIR]
//
// Exit 0 = built or unchanged (printed on stdout), non-zero = failed (stderr);
// a failure never replaces the existing EPUB.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createJiti } from 'jiti'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Settings (data/export-formatting.json) and the relative DATABASE_URL both
// resolve against the cwd, exactly as they do for the running app.
process.chdir(repo)

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    out: { type: 'string' },
    author: { type: 'string' },
    cover: { type: 'string' },
    'if-changed': { type: 'boolean', default: false },
    'state-dir': { type: 'string' },
    db: { type: 'string' },
  },
})
for (const k of ['title', 'out', 'author']) {
  if (!values[k]) {
    console.error(`missing --${k}`)
    process.exit(2)
  }
}

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(repo, 'src'), '@shared': path.join(repo, 'shared') },
})
const { resolveDbPath } = await jiti.import('@/lib/dbSafety')
const { buildEpub } = await jiti.import('@/lib/ebook/buildEpub')

const out = path.resolve(values.out)
try {
  const r = await buildEpub({
    dbPath: resolveDbPath(values.db ?? process.env.DATABASE_URL ?? 'file:./dev.db'),
    bookTitle: values.title,
    author: values.author,
    outPath: out,
    coverPath: values.cover,
    ifChanged: values['if-changed'],
    stateDir: values['state-dir'] ?? path.join(path.dirname(out), '.loom-ebook-state'),
  })
  for (const w of r.warnings) console.log(`   warning: ${w}`)
  console.log(`${r.status} — ${r.chapters} chapters, ${r.footnotes} footnotes (db read ${r.readMs}ms)`)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
