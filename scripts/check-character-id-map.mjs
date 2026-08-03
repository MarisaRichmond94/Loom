// Gate for scripts/character-id-map.json — LOOM-84.
//
//   node scripts/check-character-id-map.mjs   # exit 0 = safe to proceed
//
// ⚠️ EVERY later ticket in the character unification block runs this BEFORE it
// touches data — the LOOM-85 backfill, the LOOM-87 portrait rename, and above
// all the LOOM-89 prose remap, which rewrites character mark ids inside the
// manuscript. A map with a gap in it is how a line of prose ends up attributed
// to the wrong character, so this fails loudly and early rather than letting a
// migration discover the problem halfway through.
//
// Read-only. It checks; it never repairs. If it fails, fix the map (or create
// the missing character in WriteAI and re-run the builder) — do not make the
// checker more permissive.

import {
  MAP_PATH, readLoomCharacters, readWriterCharacters, readMap,
  loomDbPath, writerCharactersPath,
} from './character-id-map.mjs'

const problems = []
const fail = msg => problems.push(msg)

const map = readMap()
if (map === null) {
  console.error(`✗ ${MAP_PATH} does not exist — run: node scripts/build-character-id-map.mjs`)
  process.exit(1)
}

const loom = readLoomCharacters()
const writer = readWriterCharacters()
const writerIds = new Set(writer.map(w => w.id))
const nameById = new Map(loom.map(c => [c.id, c.name]))

// 1. Every Loom character is present and non-null.
for (const c of loom) {
  if (!(c.id in map)) fail(`missing from map: ${c.name} (${c.id})`)
  else if (map[c.id] === null) fail(`unmapped: ${c.name} (${c.id}) — create them in WriteAI, then re-run the builder`)
  else if (typeof map[c.id] !== 'string' || map[c.id].length === 0) {
    fail(`invalid value for ${c.name} (${c.id}): ${JSON.stringify(map[c.id])}`)
  }
}

// 2. Every mapped `wc-` id actually exists in WriteAI.
//
// This is the check that catches a character deleted or re-created on the
// WriteAI side after the map was written — the map would still look complete
// while pointing at a record that is gone.
for (const [loomId, wcId] of Object.entries(map)) {
  if (typeof wcId !== 'string') continue
  if (!writerIds.has(wcId)) {
    fail(`${nameById.get(loomId) ?? loomId} -> ${wcId} is not in WriteAI's pool (deleted or re-created?)`)
  }
}

// 3. No two Loom characters point at the same WriteAI character.
//
// A duplicate would merge two casts silently: both would inherit one set of
// traits, and the LOOM-85 backfill would write one overlay row over the other.
const seen = new Map()
for (const [loomId, wcId] of Object.entries(map)) {
  if (typeof wcId !== 'string') continue
  if (seen.has(wcId)) {
    const first = nameById.get(seen.get(wcId)) ?? seen.get(wcId)
    const second = nameById.get(loomId) ?? loomId
    fail(`${first} and ${second} both map to ${wcId} — two Loom characters cannot share one WriteAI record`)
  }
  seen.set(wcId, loomId)
}

// 4. No stale keys — a map entry for a Loom character that no longer exists.
//
// Not fatal on its own, but it means the map and the database have drifted,
// and drift is exactly what this file exists to rule out.
const loomIds = new Set(loom.map(c => c.id))
for (const loomId of Object.keys(map)) {
  if (!loomIds.has(loomId)) fail(`stale entry: ${loomId} is not a Loom character any more`)
}

console.log(`Loom:    ${loom.length} characters  (${loomDbPath()})`)
console.log(`WriteAI: ${writer.length} characters  (${writerCharactersPath()})`)
console.log(`Map:     ${Object.keys(map).length} entries  (${MAP_PATH})`)
console.log()

if (problems.length) {
  console.error(`✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} — DO NOT run any migration:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`✓ all ${loom.length} Loom characters map to a live WriteAI character, one to one.`)
