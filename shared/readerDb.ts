import Database from 'better-sqlite3'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * `reader.db` — reader identity, and later progress and comments (LOOM-132/133/134).
 *
 * SHARED, because two processes need the same definition of a reader: the
 * reader app resolves tokens against it, and Loom's settings page creates and
 * revokes them. Loom writing readers through the reader app's HTTP API was the
 * alternative, and it fails the obvious way — the settings page would only work
 * while the reader app happened to be running.
 *
 * THIS FILE NEVER TOUCHES THE MANUSCRIPT. `reader.db` is a separate file with
 * a separate handle; `dev.db` gains no tables for any of this, because reader
 * identity is not the manuscript's business. `assertNotManuscript` refuses at
 * open time rather than trusting every future caller to pass the right path.
 *
 * WAL is on: two processes write here (Loom creates readers, the reader app
 * stamps `lastSeenAt`), and the default rollback journal makes those two block
 * each other outright. `reader.db` is deliberately NOT backed up — it is
 * regenerable state, and a lost row costs one re-sent link.
 */

export type Reader = {
  id: string
  displayName: string
  token: string
  disabled: number
  createdAt: string
  lastSeenAt: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS Reader (
  id          TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  disabled    INTEGER NOT NULL DEFAULT 0,
  createdAt   TEXT NOT NULL,
  lastSeenAt  TEXT
);
`

/**
 * Refuses the manuscript, the same way the reader app's content handle does
 * (reader/src/lib/db.ts). This module opens a WRITE handle, so pointing it at
 * `dev.db` would not merely read the wrong file — it would create tables in it.
 */
export function assertNotManuscript(filePath: string): void {
  const base = filePath.split('/').pop() ?? ''
  if (base === 'dev.db' || base.startsWith('dev.db.')) {
    throw new Error(
      `\n  ✗ The reader database was pointed at the MANUSCRIPT (${filePath}).\n` +
      `    This opens a WRITE handle. Refusing.\n`,
    )
  }
}

/** Opens (and migrates) `reader.db`. Each app passes its own resolved path. */
export function openReaderDb(filePath: string): Database.Database {
  assertNotManuscript(filePath)
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}

/**
 * A new invite token: 32 bytes from the CSPRNG, base64url.
 *
 * This is a REUSABLE BEARER CREDENTIAL — whoever holds the link is that
 * reader. That is an accepted property of the design (the tailnet is the outer
 * boundary, LOOM-136), not an oversight, and it is why the token is generated
 * rather than derived from anything guessable like a name.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * The reader holding this token, or null. Includes disabled readers so callers
 * can tell "revoked" from "never existed" if they choose to.
 *
 * TIMING-SAFE, and deliberately not a `WHERE token = ?` lookup. Both sides are
 * hashed first so the comparison is fixed-width — `timingSafeEqual` throws on a
 * length mismatch, which would itself leak the token's length — and every row
 * is compared with no early exit, so the work does not depend on how many
 * candidates were checked before the match.
 */
export function findReaderByToken(db: Database.Database, token: string): Reader | null {
  if (!token) return null
  const probe = createHash('sha256').update(token).digest()
  let found: Reader | null = null
  for (const row of db.prepare(`SELECT * FROM Reader`).all() as Reader[]) {
    const stored = createHash('sha256').update(row.token).digest()
    if (timingSafeEqual(stored, probe)) found = row
  }
  return found
}

export function listReaders(db: Database.Database): Reader[] {
  return db.prepare(`SELECT * FROM Reader ORDER BY createdAt`).all() as Reader[]
}

export function createReader(db: Database.Database, displayName: string): Reader {
  const name = displayName.trim()
  if (!name) throw new Error('A reader needs a display name.')
  const reader: Reader = {
    id: randomBytes(12).toString('hex'),
    displayName: name,
    token: newToken(),
    disabled: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  }
  db.prepare(
    `INSERT INTO Reader (id, displayName, token, disabled, createdAt, lastSeenAt)
     VALUES (@id, @displayName, @token, @disabled, @createdAt, @lastSeenAt)`,
  ).run(reader)
  return reader
}

export function renameReader(db: Database.Database, id: string, displayName: string): void {
  const name = displayName.trim()
  if (!name) throw new Error('A reader needs a display name.')
  db.prepare(`UPDATE Reader SET displayName = ? WHERE id = ?`).run(name, id)
}

/**
 * Revocation. There is no session to expire and nothing to log out: the cookie
 * stops resolving on the very next request, on every device at once.
 */
export function setReaderDisabled(db: Database.Database, id: string, disabled: boolean): void {
  db.prepare(`UPDATE Reader SET disabled = ? WHERE id = ?`).run(disabled ? 1 : 0, id)
}

export function touchLastSeen(db: Database.Database, id: string): void {
  db.prepare(`UPDATE Reader SET lastSeenAt = ? WHERE id = ?`).run(new Date().toISOString(), id)
}
