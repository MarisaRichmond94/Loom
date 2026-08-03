// Build (or top up) scripts/character-id-map.json — LOOM-84.
//
//   node scripts/build-character-id-map.mjs
//
// Matches Loom characters to WriteAI writer-characters by normalised name and
// nothing else. Anything it cannot match with certainty is left `null` for a
// human, and `check-character-id-map.mjs` refuses to pass while a `null`
// remains — the whole block downstream keys off this file, and a wrong entry
// would silently attribute a character's prose, ages and portraits to someone
// else.
//
// Rules it will not bend:
//   - Existing non-null entries are NEVER overwritten. Re-running is always
//     safe, including after hand-editing.
//   - An ambiguous name (two WriteAI characters normalising the same) is left
//     unmapped and reported, rather than resolved by picking the first.
//   - Aliases and surnames are printed as HINTS only. Aliases are shared
//     between characters in this data ("Jay" is not unique) and a surname
//     match is a coincidence, not evidence.
//
// Read-only against both apps. It writes exactly one file: the map itself.

import {
  MAP_PATH, readLoomCharacters, readWriterCharacters, readMap, writeMap,
  normName, aliasList, loomDbPath, writerCharactersPath,
} from './character-id-map.mjs'

const loom = readLoomCharacters()
const writer = readWriterCharacters()
const existing = readMap() ?? {}

console.log(`Loom:    ${loom.length} characters  (${loomDbPath()})`)
console.log(`WriteAI: ${writer.length} characters  (${writerCharactersPath()})`)
console.log()

// Normalised name -> writer characters with that name. A list, so a duplicate
// name is visible as ambiguity instead of collapsing to whichever came last.
const byName = new Map()
for (const w of writer) {
  const key = normName(w.name)
  byName.set(key, [...(byName.get(key) ?? []), w])
}

const map = {}
const filled = []
const kept = []
const unmatched = []
const ambiguous = []

for (const c of loom) {
  const prior = existing[c.id]
  if (typeof prior === 'string' && prior.length > 0) {
    map[c.id] = prior
    kept.push({ ...c, wcId: prior })
    continue
  }

  const candidates = byName.get(normName(c.name)) ?? []
  if (candidates.length === 1) {
    map[c.id] = candidates[0].id
    filled.push({ ...c, wcId: candidates[0].id })
  } else if (candidates.length > 1) {
    map[c.id] = null
    ambiguous.push({ ...c, candidates })
  } else {
    map[c.id] = null
    unmatched.push(c)
  }
}

writeMap(map)

const pad = s => s.padEnd(24)
if (kept.length) console.log(`Kept ${kept.length} existing entries (never overwritten).`)
if (filled.length) {
  console.log(`\nMatched by name (${filled.length}):`)
  for (const f of filled) console.log(`  ${pad(f.name)} ${f.id} -> ${f.wcId}`)
}

if (ambiguous.length) {
  console.log(`\n⚠️  Ambiguous — two or more WriteAI characters share this name (${ambiguous.length}):`)
  for (const a of ambiguous) {
    console.log(`  ${pad(a.name)} candidates: ${a.candidates.map(c => c.id).join(', ')}`)
  }
  console.log('  Left unmapped on purpose. Pick one by hand in scripts/character-id-map.json.')
}

if (unmatched.length) {
  // Hints only. Never applied automatically — see the header.
  const aliasIndex = new Map()
  for (const w of writer) {
    for (const a of aliasList(w.aliases)) {
      aliasIndex.set(normName(a), [...(aliasIndex.get(normName(a)) ?? []), w.name])
    }
  }
  console.log(`\n⚠️  No WriteAI counterpart (${unmatched.length}) — create these in WriteAI, then re-run:`)
  for (const u of unmatched) {
    const surname = u.name.trim().split(/\s+/).pop()
    const sameSurname = writer.filter(w => w.name.includes(surname)).map(w => w.name)
    const aliasHit = aliasIndex.get(normName(u.name))
    const hints = [
      aliasHit ? `alias of ${aliasHit.join(', ')}` : null,
      sameSurname.length ? `same surname: ${sameSurname.join(', ')}` : null,
    ].filter(Boolean)
    console.log(`  ${pad(u.name)} ${hints.length ? `(${hints.join('; ')})` : '(no similar name in WriteAI)'}`)
  }
  console.log('\n  These are HINTS, not matches — a shared surname is a coincidence, not evidence.')
}

const nulls = Object.values(map).filter(v => v === null).length
console.log(`\nWrote ${MAP_PATH}`)
console.log(`${Object.keys(map).length} entries, ${nulls} still unmapped.`)
console.log(nulls === 0
  ? 'Run: node scripts/check-character-id-map.mjs'
  : 'The checker will refuse to pass until every entry is filled.')
