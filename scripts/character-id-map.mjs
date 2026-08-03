// Shared plumbing for the Loom-cuid -> WriteAI-`wc-`-id character map
// (LOOM-84, the pre-flight for the character unification block under LOOM-5).
//
// The map is permanent infrastructure, not migration scratch: after LOOM-90
// drops Loom's `Character` table, the import path still needs it to read
// `.loom.json` backups taken before the migration. Every nightly backup on
// disk today is cuid-keyed.
//
// ⚠️ Everything here is READ-ONLY against both apps' data. The database is
// opened `readonly: true` and WriteAI's JSON is never written. LOOM-84 is the
// one ticket in the block that must not be able to change anything, and that
// is enforced here rather than being left to the caller's good intentions.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

export const MAP_PATH = path.join(scriptsDir, 'character-id-map.json')

// Absolute defaults rather than paths relative to the repo root, because this
// runs from a git worktree (`~/dev/loom-characters`) that deliberately has no
// `dev.db` of its own — see the working conditions on LOOM-5. The WriteAI
// location matches the one `ops/book_backup.sh` already hardcodes.
const DEFAULT_LOOM_DB = path.join(os.homedir(), 'Documents/GitHub/Loom/dev.db')
const DEFAULT_WRITER_CHARACTERS = path.join(
  os.homedir(),
  'Documents/GitHub/WriteAi/writer_data/writer_characters.json',
)

export const loomDbPath = () => process.env.LOOM_DB ?? DEFAULT_LOOM_DB
export const writerCharactersPath = () =>
  process.env.WRITER_CHARACTERS ?? DEFAULT_WRITER_CHARACTERS

/**
 * Normalised name, for comparing a Loom name against a WriteAI one.
 *
 * Same rules as `isPovCharacter()` in `src/lib/characterSearch.ts` — NFC,
 * curly apostrophes folded to straight, case and surrounding space ignored.
 * Both sides are hand-typed by the same person, so the realistic mismatch is
 * punctuation or capitalisation rather than a genuinely different name.
 */
export const normName = v =>
  v.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()

/** Loom's characters, read-only, in the order the cast grid shows them. */
export function readLoomCharacters() {
  const file = loomDbPath()
  if (!fs.existsSync(file)) {
    throw new Error(`Loom database not found at ${file} (set LOOM_DB to override)`)
  }
  // readonly + fileMustExist: this script cannot create, migrate or write a
  // database even if pointed somewhere unexpected.
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return db.prepare('SELECT id, name FROM Character ORDER BY name').all()
  } finally {
    db.close()
  }
}

/** WriteAI's writer-character pool, straight off disk. */
export function readWriterCharacters() {
  const file = writerCharactersPath()
  if (!fs.existsSync(file)) {
    throw new Error(`WriteAI characters not found at ${file} (set WRITER_CHARACTERS to override)`)
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON array — refusing to guess at its shape`)
  }
  return parsed
}

/**
 * Read WriteAI's pool from ITS FILE, never from `GET /api/plan/characters`.
 *
 * That endpoint writes to disk on every call — it seeds from canon, prunes
 * entries canon reclassifies, and rewrites `books` from numbers to names,
 * saving whenever any of that changes. A map-checking script that ran on a
 * loop would quietly mutate the data it is checking.
 */

export function readMap() {
  if (!fs.existsSync(MAP_PATH)) return null
  return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))
}

export function writeMap(map) {
  fs.writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`)
}

/** Aliases as a list — WriteAI stores them as one comma-separated string. */
export const aliasList = aliases =>
  (aliases ?? '').split(',').map(a => a.trim()).filter(Boolean)
