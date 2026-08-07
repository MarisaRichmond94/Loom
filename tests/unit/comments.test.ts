import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import type Database from 'better-sqlite3'

import {
  addComment,
  commentCounts,
  createReader,
  deleteOwnComment,
  listComments,
  openReaderDb,
  setCommentHidden,
} from '@shared/readerDb'

// Reader comments (LOOM-134).

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'comments-'))
  db = openReaderDb(path.join(dir, 'reader.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const post = (readerId: string, body: string, chapterId = 'ch1') =>
  addComment(db, { readerId, bookId: 'b1', chapterId, body })

describe('everyone sees everyone', () => {
  it('returns all readers’ comments on a chapter, oldest first', () => {
    const mom = createReader(db, 'Mom')
    const dan = createReader(db, 'Dan')
    post(mom.id, 'first')
    post(dan.id, 'second')

    expect(listComments(db, 'ch1').map(c => c.body)).toEqual(['first', 'second'])
  })

  it('keeps chapters separate', () => {
    const mom = createReader(db, 'Mom')
    post(mom.id, 'on one', 'ch1')
    post(mom.id, 'on two', 'ch2')
    expect(listComments(db, 'ch1').map(c => c.body)).toEqual(['on one'])
  })

  it('refuses an empty comment', () => {
    const mom = createReader(db, 'Mom')
    expect(() => post(mom.id, '   ')).toThrow()
  })
})

describe('author moderation is soft', () => {
  it('hides from readers but keeps the row', () => {
    const mom = createReader(db, 'Mom')
    const c = post(mom.id, 'too much')

    setCommentHidden(db, c.id, true)
    expect(listComments(db, 'ch1')).toHaveLength(0)
    // Still there for the author (LOOM-135), and reversible — a mis-click
    // must not destroy someone's words.
    expect(listComments(db, 'ch1', true)).toHaveLength(1)

    setCommentHidden(db, c.id, false)
    expect(listComments(db, 'ch1')).toHaveLength(1)
  })

  it('excludes hidden comments from counts', () => {
    const mom = createReader(db, 'Mom')
    post(mom.id, 'a')
    const b = post(mom.id, 'b')
    setCommentHidden(db, b.id, true)
    expect(commentCounts(db, 'b1').get('ch1')).toBe(1)
  })
})

describe('a reader may retract their own words, and only their own', () => {
  it('deletes their own', () => {
    const mom = createReader(db, 'Mom')
    const c = post(mom.id, 'mine')
    expect(deleteOwnComment(db, c.id, mom.id)).toBe(true)
    expect(listComments(db, 'ch1')).toHaveLength(0)
  })

  it('will not delete someone else’s, even with the right id', () => {
    const mom = createReader(db, 'Mom')
    const dan = createReader(db, 'Dan')
    const c = post(mom.id, 'hers')

    expect(deleteOwnComment(db, c.id, dan.id)).toBe(false)
    expect(listComments(db, 'ch1')).toHaveLength(1)
  })
})

describe('comments outlive the prose they were about', () => {
  it('survives its chapter disappearing', () => {
    // Nothing here deletes them, which IS the assertion: republishing removes
    // chapters from content.db and never touches this table. Deleting a family
    // member's reaction because a scene was revised is the wrong default — the
    // prose is replaceable, their reaction is not.
    const mom = createReader(db, 'Mom')
    post(mom.id, 'loved this', 'chapter-that-will-be-cut')

    expect(listComments(db, 'chapter-that-will-be-cut')).toHaveLength(1)
  })

  it('records which published version was being read', () => {
    const mom = createReader(db, 'Mom')
    const c = addComment(db, {
      readerId: mom.id, bookId: 'b1', chapterId: 'ch1',
      body: 'x', publishedAt: '2026-08-06T00:00:00.000Z',
    })
    expect(c.publishedAt).toBe('2026-08-06T00:00:00.000Z')
  })

  it('is chapter-level in v1', () => {
    const mom = createReader(db, 'Mom')
    // Inline anchoring is deferred on purpose: character offsets into prose
    // still being revised rot the moment a paragraph is edited.
    expect(post(mom.id, 'x').blockId).toBeNull()
  })
})

describe('the reader app cannot reach the manuscript', () => {
  // The ticket's own acceptance criterion, and the one worth enforcing by sweep
  // rather than by inspection: dev.db is the only irreplaceable file here.
  const APP = path.join(__dirname, '../../reader/src')

  function sources(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'shared') continue // generated mirror, checked at its source
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) sources(full, found)
      else if (/\.tsx?$/.test(name)) found.push(full)
    }
    return found
  }

  it('no file names dev.db outside a comment', () => {
    const offenders = sources(APP).filter(f => {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      // db.ts REFUSES dev.db by name; that string is the guard, not a path.
      if (f.endsWith(path.join('lib', 'db.ts'))) return false
      return code.includes('dev.db')
    })
    expect(offenders).toEqual([])
  })

  it('no file imports prisma', () => {
    const offenders = sources(APP).filter(f => readFileSync(f, 'utf8').includes('@prisma/client'))
    expect(offenders).toEqual([])
  })
})
