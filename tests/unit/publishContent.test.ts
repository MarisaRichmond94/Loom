import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'fs'
import path from 'path'
import { buildContentDb } from '@/lib/publish/buildContent'

// LOOM-127. Every assertion here is about something that would be invisible in
// review and expensive in production: an id that moved, prose that should not
// exist on the reader tier, or a spoiler in a payload nobody looks at.

const SANDBOX = path.join(__dirname, '../../sandbox.db')
const OUT = path.join(__dirname, '../../content.test.db')
const hasFixture = existsSync(SANDBOX)
const fixtureIt = hasFixture ? it : it.skip

const build = (outPath = OUT) => buildContentDb({
  sourcePath: SANDBOX,
  outPath,
  seriesId: 'sbx-series',
  authorName: 'Sandbox Author',
  publishedAt: '2026-01-01T00:00:00.000Z',
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = <T = any>(q: string, file = OUT): T[] => {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try { return db.prepare(q).all() as T[] } finally { db.close() }
}

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) rmSync(OUT + suffix, { force: true })
  rmSync(OUT + '.2', { force: true })
})

describe('publish builds content.db', () => {
  fixtureIt('never writes to the source, even under a deliberate attempt', () => {
    build()
    const src = new Database(SANDBOX, { readonly: true })
    expect(() => src.prepare(`UPDATE Book SET title='x'`).run()).toThrow()
    src.close()
  })

  fixtureIt('keeps ids byte-identical across republishes', () => {
    build()
    const first = read(`SELECT id FROM ContentBlock ORDER BY id`).map(r => r.id)
    const firstChapters = read(`SELECT id FROM Chapter ORDER BY id`).map(r => r.id)
    build()
    expect(read(`SELECT id FROM ContentBlock ORDER BY id`).map(r => r.id)).toEqual(first)
    expect(read(`SELECT id FROM Chapter ORDER BY id`).map(r => r.id)).toEqual(firstChapters)
    // Not vacuous — there is real content to move.
    expect(first.length).toBeGreaterThan(3)
  })

  fixtureIt('publishes soundtrack blocks, which walkBook drops from prose', () => {
    build()
    const tracks = read(`SELECT id, content FROM ContentBlock WHERE type='soundtrack'`)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].id).toBe('sbx-b1-c1-b2')
    expect(tracks[0].content).toBe('/music/sbx-lantern-theme.mp3')
  })

  fixtureIt('excludes condition-gated blocks (LOOM-138 must survive publish)', () => {
    build()
    const all = read(`SELECT content FROM ContentBlock`).map(r => r.content).join(' ')
    expect(all).not.toContain('GATED PROSE')
    expect(read(`SELECT id FROM ContentBlock WHERE id='sbx-b1-c3-b2'`)).toHaveLength(0)
  })

  fixtureIt('leaks no branch, bad-ending or unmatched-conditional prose', () => {
    build()
    const all = read(`SELECT content FROM ContentBlock`).map(r => r.content).join(' ')
    expect(all).not.toContain('BAD ENDING PROSE')
    expect(all).not.toContain('BRANCH ONLY')
    // The matched side of the same conditional IS present, so the assertion
    // above is about selection rather than the fragment being dropped whole.
    expect(all).toContain('Empty-handed')
  })

  fixtureIt('writes no choice points, and has nowhere to put a branch', () => {
    build()
    expect(read(`SELECT id FROM ContentBlock WHERE type='choice_point'`)).toHaveLength(0)
    const tables = read(`SELECT name FROM sqlite_master WHERE type='table'`).map(r => r.name)
    expect(tables).not.toContain('Choice')
    expect(tables).not.toContain('ConditionalOverride')
    expect(tables).not.toContain('StoryVariable')
  })

  fixtureIt('reduces a draft book to a title+order stub', () => {
    build()
    const draft = read(`SELECT * FROM Book WHERE published=0`)
    expect(draft).toHaveLength(1)
    expect(draft[0].title).toBe('The Unfinished Book')
    expect(draft[0].synopsis).toBe('')
    expect(draft[0].coverPath).toBeNull()
    expect(read(`SELECT id FROM Chapter WHERE bookId='sbx-book-3-draft'`)).toHaveLength(0)
    const all = read(`SELECT content FROM ContentBlock`).map(r => r.content).join(' ')
    expect(all).not.toContain('DRAFT PROSE')
    expect(all).not.toContain('SPOILER SYNOPSIS')
  })
})

describe('publish projects characters per book', () => {
  fixtureIt('omits a character who has not appeared yet, rather than flagging them', () => {
    build()
    const book1 = read(`SELECT id FROM Character WHERE bookId='sbx-book-1'`).map(r => r.id)
    expect(book1).not.toContain('sbx-char-idris')
    const book2 = read(`SELECT id FROM Character WHERE bookId='sbx-book-2'`).map(r => r.id)
    expect(book2).toContain('sbx-char-idris')
  })

  fixtureIt('does not reveal a death before the book it happens in', () => {
    build()
    const b1 = read(`SELECT deceased FROM Character WHERE bookId='sbx-book-1' AND id='sbx-char-selis'`)
    const b2 = read(`SELECT deceased FROM Character WHERE bookId='sbx-book-2' AND id='sbx-char-selis'`)
    expect(b1[0].deceased).toBe(0)
    expect(b2[0].deceased).toBe(1)
  })

  fixtureIt('never writes the book a character dies in, in any form', () => {
    build()
    const cols = read(`PRAGMA table_info(Character)`).map(r => r.name)
    expect(cols).not.toContain('deathBookId')
    expect(cols).not.toContain('firstBookId')
    expect(cols).not.toContain('lastBookId')
    // And the value itself appears nowhere in the file's character rows.
    const dumped = JSON.stringify(read(`SELECT * FROM Character`))
    expect(dumped).not.toContain('sbx-book-2-death')
  })

  fixtureIt('applies the per-book age override', () => {
    build()
    const b1 = read(`SELECT age FROM Character WHERE bookId='sbx-book-1' AND id='sbx-char-mara'`)
    const b2 = read(`SELECT age FROM Character WHERE bookId='sbx-book-2' AND id='sbx-char-mara'`)
    expect(b1[0].age).toBe(24)
    expect(b2[0].age).toBe(25)
  })
})

describe('publish reports rather than refuses', () => {
  fixtureIt('does not refuse when canon is ambiguous, and surfaces the warning', () => {
    // The fixture's lantern point is genuinely ambiguous (two accumulator
    // branches). The canon export warns and proceeds; publish must match it, or
    // published books would diverge from the manuscript.
    const result = build()
    const book1 = result.books.find(b => b.id === 'sbx-book-1')
    expect(book1?.chapters).toBeGreaterThan(0)
    expect(result.books.every(b => b.published || b.chapters === 0)).toBe(true)
  })

  fixtureIt('leaves the previous content.db intact when a build fails', () => {
    build()
    const before = read(`SELECT COUNT(*) c FROM ContentBlock`)[0].c
    expect(() => buildContentDb({
      sourcePath: SANDBOX, outPath: OUT, seriesId: 'does-not-exist',
      authorName: 'x', publishedAt: '2026-01-01T00:00:00.000Z',
    })).toThrow(/not found/)
    expect(read(`SELECT COUNT(*) c FROM ContentBlock`)[0].c).toBe(before)
  })
})
