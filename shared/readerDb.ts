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

export type ReadingProgress = {
  readerId: string
  bookId: string
  chapterId: string
  /** The chapter before `chapterId` when this was saved; null in chapter one. */
  prevChapterId: string | null
  offset: number
  updatedAt: string
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

-- Reading position, one row per reader per book (LOOM-133).
--
-- bookId and chapterId are cuids from content.db — a cross-FILE join, so there
-- are deliberately no foreign keys: republishing can legitimately remove the
-- chapter someone is standing in, and the resolution ladder handles that rather
-- than a constraint refusing the write.
--
-- The offset column is a PARAGRAPH INDEX, not a pixel scroll position. The
-- entire point of server-side progress is that a position set on a laptop means
-- something on a phone, and a pixel offset does not survive a change of
-- viewport width, font size, or orientation.
CREATE TABLE IF NOT EXISTS ReadingProgress (
  readerId  TEXT NOT NULL,
  bookId    TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  -- The chapter preceding chapterId at the moment this was saved. Recorded
  -- because a deleted chapter takes its position in the order with it, and
  -- "drop them to the previous chapter" is unanswerable afterwards.
  prevChapterId TEXT,
  offset    INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (readerId, bookId)
);

CREATE INDEX IF NOT EXISTS ReadingProgress_reader_idx
  ON ReadingProgress (readerId, updatedAt DESC);
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

// ---- reading progress (LOOM-133) -------------------------------------------

/**
 * Records where a reader is in a book. One row per (reader, book): moving to a
 * new chapter REPLACES the position rather than appending, because "where am I"
 * has exactly one answer per book and a history would only invite guessing
 * which entry is current.
 */
export function saveProgress(
  db: Database.Database,
  readerId: string,
  bookId: string,
  chapterId: string,
  offset: number,
  prevChapterId: string | null = null,
): void {
  db.prepare(
    `INSERT INTO ReadingProgress (readerId, bookId, chapterId, prevChapterId, offset, updatedAt)
     VALUES (@readerId, @bookId, @chapterId, @prevChapterId, @offset, @updatedAt)
     ON CONFLICT(readerId, bookId) DO UPDATE SET
       chapterId     = excluded.chapterId,
       prevChapterId = excluded.prevChapterId,
       offset        = excluded.offset,
       updatedAt     = excluded.updatedAt`,
  ).run({
    readerId,
    bookId,
    chapterId,
    prevChapterId,
    offset: Math.max(0, Math.floor(offset)),
    updatedAt: new Date().toISOString(),
  })
}

export function getProgress(
  db: Database.Database,
  readerId: string,
  bookId: string,
): ReadingProgress | null {
  return (db.prepare(
    `SELECT * FROM ReadingProgress WHERE readerId = ? AND bookId = ?`,
  ).get(readerId, bookId) as ReadingProgress | undefined) ?? null
}

/** Everything this reader has started, most recently read first. */
export function listProgress(db: Database.Database, readerId: string): ReadingProgress[] {
  return db.prepare(
    `SELECT * FROM ReadingProgress WHERE readerId = ? ORDER BY updatedAt DESC`,
  ).all(readerId) as ReadingProgress[]
}

/** Used when a book leaves the snapshot entirely — the position has nowhere to point. */
export function dropProgress(db: Database.Database, readerId: string, bookId: string): void {
  db.prepare(`DELETE FROM ReadingProgress WHERE readerId = ? AND bookId = ?`).run(readerId, bookId)
}
