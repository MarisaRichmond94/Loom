import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import type Database from 'better-sqlite3'

import {
  assertNotManuscript,
  createReader,
  findReaderByToken,
  listReaders,
  newToken,
  openReaderDb,
  renameReader,
  setReaderDisabled,
  touchLastSeen,
} from '@shared/readerDb'

// Reader identity (LOOM-132). Invite tokens, no accounts.
//
// The security-relevant parts are pinned here because none of them fail
// visibly: a token generated from a weak source still looks random, a `WHERE
// token = ?` lookup still returns the right reader, and a write handle pointed
// at the wrong file still works perfectly — right up until it has created
// tables in the manuscript.

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'readerdb-'))
  db = openReaderDb(path.join(dir, 'reader.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the write handle refuses the manuscript', () => {
  // The reader app's content handle is read-only, so pointing IT at dev.db
  // would merely be wrong. This one writes, and `openReaderDb` runs CREATE
  // TABLE — so the same mistake here would add tables to the manuscript.
  it.each(['dev.db', 'dev.db.backup', '/Users/x/Loom/dev.db'])('refuses %s', p => {
    expect(() => assertNotManuscript(p)).toThrow(/MANUSCRIPT/)
  })

  it('refuses before opening, not after', () => {
    expect(() => openReaderDb(path.join(dir, 'dev.db'))).toThrow(/MANUSCRIPT/)
  })

  it('allows reader.db', () => {
    expect(() => assertNotManuscript('/Users/x/Loom/reader/reader.db')).not.toThrow()
  })
})

describe('tokens', () => {
  it('are 32 bytes of base64url', () => {
    const t = newToken()
    // 32 bytes → 43 base64url chars, and no +/= to mangle in a URL path.
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('do not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken()))
    expect(seen.size).toBe(500)
  })

  it('are not derived from the display name', () => {
    // Two readers with the SAME name must not collide or correlate — the token
    // is identity, the name is a label.
    const a = createReader(db, 'Mom')
    const b = createReader(db, 'Mom')
    expect(a.token).not.toEqual(b.token)
    expect(a.id).not.toEqual(b.id)
  })
})

describe('resolving a token', () => {
  it('finds the holder', () => {
    const mom = createReader(db, 'Mom')
    expect(findReaderByToken(db, mom.token)?.id).toBe(mom.id)
  })

  it('returns null for an unknown token', () => {
    createReader(db, 'Mom')
    expect(findReaderByToken(db, newToken())).toBeNull()
  })

  it('returns null for an empty token rather than matching anything', () => {
    createReader(db, 'Mom')
    expect(findReaderByToken(db, '')).toBeNull()
  })

  it('tolerates a token of a different length', () => {
    // timingSafeEqual THROWS on mismatched lengths, so a short token in the URL
    // would 500 the route instead of being rejected. Hashing both sides first
    // is what makes this a rejection.
    createReader(db, 'Mom')
    expect(() => findReaderByToken(db, 'x')).not.toThrow()
    expect(findReaderByToken(db, 'x')).toBeNull()
  })

  it('picks the right reader out of many', () => {
    const readers = ['Mom', 'Dan', 'Kate', 'Sam'].map(n => createReader(db, n))
    for (const r of readers) {
      expect(findReaderByToken(db, r.token)?.displayName).toBe(r.displayName)
    }
  })

  it('still resolves a disabled reader, so callers can tell revoked from unknown', () => {
    const mom = createReader(db, 'Mom')
    setReaderDisabled(db, mom.id, true)
    const found = findReaderByToken(db, mom.token)
    expect(found?.id).toBe(mom.id)
    expect(found?.disabled).toBe(1)
  })
})

describe('the author-side operations', () => {
  it('lists readers in creation order', () => {
    createReader(db, 'Mom')
    createReader(db, 'Dan')
    expect(listReaders(db).map(r => r.displayName)).toEqual(['Mom', 'Dan'])
  })

  it('renames without changing the token', () => {
    const r = createReader(db, 'Mom')
    renameReader(db, r.id, 'Mum')
    const after = listReaders(db)[0]
    expect(after.displayName).toBe('Mum')
    // The link already went out. Renaming must not invalidate it.
    expect(after.token).toBe(r.token)
  })

  it('refuses an empty display name', () => {
    expect(() => createReader(db, '   ')).toThrow()
    const r = createReader(db, 'Mom')
    expect(() => renameReader(db, r.id, '')).toThrow()
  })

  it('revokes and restores', () => {
    const r = createReader(db, 'Mom')
    setReaderDisabled(db, r.id, true)
    expect(findReaderByToken(db, r.token)?.disabled).toBe(1)
    setReaderDisabled(db, r.id, false)
    expect(findReaderByToken(db, r.token)?.disabled).toBe(0)
  })

  it('records last seen', () => {
    const r = createReader(db, 'Mom')
    expect(r.lastSeenAt).toBeNull()
    touchLastSeen(db, r.id)
    expect(listReaders(db)[0].lastSeenAt).not.toBeNull()
  })
})

describe('the schema stays confined to the reader tier', () => {
  it('creates only the reader-tier tables', () => {
    // Exhaustive on purpose. The value of this assertion is that it FAILS when
    // a table is added — at which point the question "does this belong in the
    // reader's database or the manuscript's?" gets asked deliberately rather
    // than by whoever was mid-feature. ReadingProgress (LOOM-133) was added
    // that way; the manuscript still gains nothing.
    const tables = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as { name: string }[]).map(t => t.name).sort()
    expect(tables).toEqual(['Reader', 'ReadingProgress'])
  })

  it('is safe to open twice — migration is idempotent', () => {
    const p = path.join(dir, 'twice.db')
    const a = openReaderDb(p)
    createReader(a, 'Mom')
    a.close()
    const b = openReaderDb(p)
    expect(listReaders(b).map(r => r.displayName)).toEqual(['Mom'])
    b.close()
  })
})
