import { mkdtempSync, rmSync } from 'fs'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import type Database from 'better-sqlite3'

import {
  createReader,
  dropProgress,
  getProgress,
  listProgress,
  openReaderDb,
  saveProgress,
} from '@shared/readerDb'

// Reading progress (LOOM-133) — the acceptance criteria that are about WHOSE
// position it is, which no amount of clicking through one browser can show.

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'progress-'))
  db = openReaderDb(path.join(dir, 'reader.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('a position belongs to a person, not a browser', () => {
  it('two readers on one browser keep independent positions', () => {
    // The old design stored one slot per series per BROWSER, so a husband
    // reading on his wife's laptop inherited her position — and moved it.
    const mom = createReader(db, 'Mom')
    const dan = createReader(db, 'Dan')

    saveProgress(db, mom.id, 'book1', 'ch9', 40, 'ch8')
    saveProgress(db, dan.id, 'book1', 'ch2', 3, 'ch1')

    expect(getProgress(db, mom.id, 'book1')).toMatchObject({ chapterId: 'ch9', offset: 40 })
    expect(getProgress(db, dan.id, 'book1')).toMatchObject({ chapterId: 'ch2', offset: 3 })
  })

  it('one reader on two devices shares a single position', () => {
    // Both devices carry the same token, so both resolve to the same row.
    // The second device's write MOVES the position rather than forking it.
    const mom = createReader(db, 'Mom')
    saveProgress(db, mom.id, 'book1', 'ch4', 10, 'ch3')  // laptop
    saveProgress(db, mom.id, 'book1', 'ch7', 2, 'ch6')   // phone

    expect(listProgress(db, mom.id)).toHaveLength(1)
    expect(getProgress(db, mom.id, 'book1')).toMatchObject({ chapterId: 'ch7', offset: 2 })
  })

  it('keeps one position per book, not per chapter', () => {
    const mom = createReader(db, 'Mom')
    saveProgress(db, mom.id, 'book1', 'ch4', 10, 'ch3')
    saveProgress(db, mom.id, 'book2', 'ch1', 0, null)
    saveProgress(db, mom.id, 'book1', 'ch5', 1, 'ch4')

    const all = listProgress(db, mom.id)
    expect(all).toHaveLength(2)
    expect(all.map(p => p.bookId).sort()).toEqual(['book1', 'book2'])
  })

  it('survives the reader clearing browser storage', () => {
    // Nothing to simulate, which IS the point: the position is a row on the
    // server. The old failure was that localStorage held the only INDEX to it,
    // so clearing it stranded a perfectly good row forever and silently
    // started the book over.
    const mom = createReader(db, 'Mom')
    saveProgress(db, mom.id, 'book1', 'ch9', 40, 'ch8')

    db.close()
    db = openReaderDb(path.join(dir, 'reader.db')) // a brand-new browser

    expect(getProgress(db, mom.id, 'book1')).toMatchObject({ chapterId: 'ch9', offset: 40 })
  })

  it('drops a position when its book leaves the snapshot', () => {
    const mom = createReader(db, 'Mom')
    saveProgress(db, mom.id, 'book1', 'ch9', 40, 'ch8')
    dropProgress(db, mom.id, 'book1')
    expect(getProgress(db, mom.id, 'book1')).toBeNull()
  })

  it('never stores a negative offset', () => {
    const mom = createReader(db, 'Mom')
    saveProgress(db, mom.id, 'book1', 'ch1', -3, null)
    expect(getProgress(db, mom.id, 'book1')?.offset).toBe(0)
  })
})

describe('the reader tier does not keep progress in the browser', () => {
  const read = (p: string) => readFileSync(path.join(__dirname, '../../reader/src', p), 'utf8')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it.each([
    'components/useProgressRecorder.ts',
    'components/ChapterView.tsx',
    'lib/progress.ts',
  ])('%s never reads or writes localStorage for a position', file => {
    // localStorage is what LOOM-133 exists to get away from. The theme toggle
    // legitimately uses it elsewhere; progress must not.
    expect(strip(read(file))).not.toContain('localStorage')
  })

  it('the recorder never trusts the client for identity', () => {
    // The reader id comes from the cookie, server-side. A body-supplied one
    // would let anyone reaching the host write into someone else's position.
    const src = strip(read('app/api/progress/route.ts'))
    expect(src).toContain('resolveReader()')
    expect(src).not.toMatch(/body[.?]*\.readerId/)
  })

  it('the predecessor is resolved on the server, not sent by the page', () => {
    expect(strip(read('lib/progress.ts'))).toContain('SELECT prev.id FROM Chapter cur')
    expect(strip(read('app/api/progress/route.ts'))).not.toContain('prevChapterId')
  })
})

describe('the author’s own preview state is left alone', () => {
  it('ReaderSession stays in the manuscript schema, untouched', () => {
    // dev.db's ReaderSession serves Loom's /read view — story state, choice
    // history, the author verifying canon paths. It is NOT this tier's data,
    // and the ticket is explicit that it must not be migrated or dropped.
    const schema = readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8')
    expect(schema).toMatch(/^model ReaderSession\b/m)
    expect(schema).toContain('storyState')
    expect(schema).toContain('choiceHistory')
  })

  it('the reader tier never touches ReaderSession', () => {
    const strip2 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const f of ['lib/progress.ts', 'app/api/progress/route.ts']) {
      const src = strip2(readFileSync(path.join(__dirname, '../../reader/src', f), 'utf8'))
      expect(src).not.toContain('ReaderSession')
    }
  })
})
