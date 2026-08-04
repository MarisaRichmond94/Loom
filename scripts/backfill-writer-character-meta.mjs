// Backfill WriterCharacterMeta / WriterCharacterBookMeta from Loom's native
// Character / CharacterBookOverride rows — LOOM-85, under LOOM-5.
//
//   node scripts/backfill-writer-character-meta.mjs              # dry run
//   node scripts/backfill-writer-character-meta.mjs --apply      # write
//
// Dry run is the DEFAULT and writing takes an explicit flag, because the
// realistic way to hurt this project is a script run against the wrong
// database by reflex.
//
// What it does NOT touch: Character, CharacterBookOverride, ContentBlock, or
// any other pre-existing table. It only ever writes the two new tables. Both
// systems hold the same overlay data until LOOM-90 drops the old one, and that
// overlap is what makes every step in between revertible.
//
// Re-runnable: upserts on the unique keys, so running it twice changes
// nothing the second time.

import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMap, loomDbPath } from './character-id-map.mjs'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const apply = process.argv.includes('--apply')

// ---------------------------------------------------------------------------
// Gate: the id map must be complete and consistent before anything is written.
// Reused as a child process rather than reimplemented, so there is exactly one
// definition of "the map is safe" — see check-character-id-map.mjs.
// ---------------------------------------------------------------------------
try {
  execFileSync('node', [path.join(scriptsDir, 'check-character-id-map.mjs')], { stdio: 'inherit' })
} catch {
  console.error('\n✗ id map check failed — refusing to backfill.')
  process.exit(1)
}

const map = readMap()

// cuid v1 shape, matching what Prisma's @default(cuid()) produces for rows the
// app creates. Generated here because this script talks to SQLite directly:
// the Prisma client for this schema is TypeScript output and cannot be
// imported from a plain node script.
let counter = Math.floor(Math.random() * 1e6)
const fingerprint = crypto.randomBytes(2).toString('hex')
const cuid = () =>
  'c' +
  Date.now().toString(36) +
  (counter++ % 1679616).toString(36).padStart(4, '0') +
  fingerprint +
  crypto.randomBytes(4).toString('hex')

const db = new Database(loomDbPath(), { fileMustExist: true, readonly: !apply })
db.pragma('foreign_keys = ON')

const characters = db.prepare(
  'SELECT id, seriesId, name, age, starred, firstBookId, deathBookId, lastBookId FROM Character',
).all()
const overrides = db.prepare(
  'SELECT id, characterId, bookId, age FROM CharacterBookOverride',
).all()

console.log(`\nSource: ${characters.length} Character, ${overrides.length} CharacterBookOverride`)
console.log(`Target: ${loomDbPath()}`)
console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   dry run (pass --apply to write)\n')

// ---------------------------------------------------------------------------
// Plan every row before writing any of them, so a problem is a refusal rather
// than a half-finished table.
// ---------------------------------------------------------------------------
const metaPlan = []
const bookPlan = []
const problems = []

for (const c of characters) {
  const writerCharacterId = map[c.id]
  if (!writerCharacterId) {
    problems.push(`${c.name} (${c.id}) has no mapped wc- id`)
    continue
  }
  metaPlan.push({
    characterId: c.id,
    name: c.name,
    seriesId: c.seriesId,
    writerCharacterId,
    age: c.age,
    // SQLite stores booleans as 0/1; normalise rather than passing through.
    starred: c.starred ? 1 : 0,
    firstBookId: c.firstBookId,
    deathBookId: c.deathBookId,
    lastBookId: c.lastBookId,
  })
}

const byCharacterId = new Map(metaPlan.map(m => [m.characterId, m]))
for (const o of overrides) {
  const meta = byCharacterId.get(o.characterId)
  if (!meta) {
    problems.push(`override ${o.id} belongs to unmapped character ${o.characterId}`)
    continue
  }
  bookPlan.push({ characterId: o.characterId, bookId: o.bookId, age: o.age, name: meta.name })
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) — nothing written:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

if (!apply) {
  for (const m of metaPlan.slice(0, 5)) {
    console.log(`  ${m.name.padEnd(22)} ${m.writerCharacterId}  age=${m.age ?? '—'} starred=${m.starred}`)
  }
  if (metaPlan.length > 5) console.log(`  … and ${metaPlan.length - 5} more`)
  console.log(`\nWould write ${metaPlan.length} WriterCharacterMeta + ${bookPlan.length} WriterCharacterBookMeta rows.`)
  console.log('Nothing was written. Re-run with --apply.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Write. One transaction: either the whole overlay lands or none of it does.
// ---------------------------------------------------------------------------
const selectMeta = db.prepare(
  'SELECT id FROM WriterCharacterMeta WHERE seriesId = ? AND writerCharacterId = ?',
)
const insertMeta = db.prepare(`
  INSERT INTO WriterCharacterMeta (id, seriesId, writerCharacterId, age, starred, firstBookId, deathBookId, lastBookId)
  VALUES (@id, @seriesId, @writerCharacterId, @age, @starred, @firstBookId, @deathBookId, @lastBookId)
`)
const updateMeta = db.prepare(`
  UPDATE WriterCharacterMeta
     SET age = @age, starred = @starred, firstBookId = @firstBookId,
         deathBookId = @deathBookId, lastBookId = @lastBookId
   WHERE id = @id
`)
const selectBookMeta = db.prepare('SELECT id FROM WriterCharacterBookMeta WHERE metaId = ? AND bookId = ?')
const insertBookMeta = db.prepare(
  'INSERT INTO WriterCharacterBookMeta (id, metaId, bookId, age) VALUES (@id, @metaId, @bookId, @age)',
)
const updateBookMeta = db.prepare('UPDATE WriterCharacterBookMeta SET age = @age WHERE id = @id')

let metaInserted = 0, metaUpdated = 0, bookInserted = 0, bookUpdated = 0
const metaIdByCharacterId = new Map()

db.transaction(() => {
  for (const m of metaPlan) {
    const existing = selectMeta.get(m.seriesId, m.writerCharacterId)
    const id = existing?.id ?? cuid()
    if (existing) { updateMeta.run({ ...m, id }); metaUpdated++ }
    else { insertMeta.run({ ...m, id }); metaInserted++ }
    metaIdByCharacterId.set(m.characterId, id)
  }
  for (const b of bookPlan) {
    const metaId = metaIdByCharacterId.get(b.characterId)
    const existing = selectBookMeta.get(metaId, b.bookId)
    const id = existing?.id ?? cuid()
    if (existing) { updateBookMeta.run({ id, age: b.age }); bookUpdated++ }
    else { insertBookMeta.run({ id, metaId, bookId: b.bookId, age: b.age }); bookInserted++ }
  }
})()

// ---------------------------------------------------------------------------
// Verify against the SOURCE counts, not against a number written down when
// this was planned — the override count has already moved once during the
// epic, and a hardcoded expectation would have failed for the wrong reason.
// ---------------------------------------------------------------------------
const metaCount = db.prepare('SELECT count(*) n FROM WriterCharacterMeta').get().n
const bookCount = db.prepare('SELECT count(*) n FROM WriterCharacterBookMeta').get().n
const untouched = db.prepare('SELECT count(*) n FROM Character').get().n
const untouchedOverrides = db.prepare('SELECT count(*) n FROM CharacterBookOverride').get().n
db.close()

console.log(`WriterCharacterMeta:     ${metaInserted} inserted, ${metaUpdated} updated -> ${metaCount} rows`)
console.log(`WriterCharacterBookMeta: ${bookInserted} inserted, ${bookUpdated} updated -> ${bookCount} rows`)
console.log(`Character:               ${untouched} rows (unchanged)`)
console.log(`CharacterBookOverride:   ${untouchedOverrides} rows (unchanged)`)

const ok = metaCount === characters.length && bookCount === overrides.length
console.log(ok
  ? `\n✓ overlay matches source: ${characters.length} + ${overrides.length}`
  : `\n✗ MISMATCH — expected ${characters.length} + ${overrides.length}, got ${metaCount} + ${bookCount}`)
process.exit(ok ? 0 : 1)
