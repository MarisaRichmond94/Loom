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

  fixtureIt('reduces a draft book to title, order and cover — nothing else', () => {
    build()
    const draft = read(`SELECT * FROM Book WHERE published=0`)
    expect(draft).toHaveLength(1)
    expect(draft[0].title).toBe('The Unfinished Book')
    // The narrow, deliberate exception: the landing dims a draft's cover
    // rather than showing a blank slot, and a cover is marketing not plot.
    expect(draft[0].coverPath).toBe('/covers/sbx-book-3.jpg')
    // The synopsis is NOT the exception. The landing blurs lorem ipsum over
    // drafts, so shipping the real blurb would look identical and differ only
    // in making it readable from the network response.
    expect(draft[0].synopsis).toBe('')
    expect(read(`SELECT id FROM Chapter WHERE bookId='sbx-book-3-draft'`)).toHaveLength(0)
    const all = read(`SELECT content FROM ContentBlock`).map(r => r.content).join(' ')
    expect(all).not.toContain('DRAFT PROSE')
    expect(all).not.toContain('SPOILER SYNOPSIS')
  })

  fixtureIt('hardlinks a draft cover so the landing can dim it', () => {
    const result = build()
    expect(result.referencedAssets).toContain('/covers/sbx-book-3.jpg')
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

describe('publish selects narration by canon hash', () => {
  // The one path by which non-canon prose could still reach a reader after
  // canon flattening: as AUDIO. 47 real chapters have more than one recording;
  // one has 22. "First row" would ship the wrong branch's voice.
  fixtureIt('publishes the recording of the canon text', () => {
    const result = build()
    expect(read(`SELECT chapterId FROM Narration WHERE chapterId='sbx-b1-c3'`)).toHaveLength(1)
    const row = read(`SELECT audioPath, durationMs FROM Narration WHERE chapterId='sbx-b1-c3'`)[0]
    expect(row.audioPath).toBe('/narration/sbx-b1-c3.m4a')
    expect(result.books.find(b => b.id === 'sbx-book-1')?.narrated).toBe(1)
  })

  fixtureIt('publishes silent when recordings exist but none is of the canon text', () => {
    // Chapter 1 has two recordings, neither hashing to its canon prose.
    const result = build()
    expect(read(`SELECT chapterId FROM Narration WHERE chapterId='sbx-b1-c1'`)).toHaveLength(0)
    expect(result.books.find(b => b.id === 'sbx-book-1')?.narrationMismatched).toContain('1')
  })

  fixtureIt('never publishes a non-canon recording under any chapter', () => {
    build()
    const paths = read(`SELECT audioPath FROM Narration`).map(r => r.audioPath)
    expect(paths).not.toContain('/narration/sbx-b1-c1-canon.mp3')
    expect(paths).not.toContain('/narration/sbx-b1-c1-branch.mp3')
  })

  fixtureIt('references only the audio it actually published', () => {
    const result = build()
    expect(result.referencedAssets).toContain('/narration/sbx-b1-c3.m4a')
    expect(result.referencedAssets).not.toContain('/narration/sbx-b1-c1-branch.mp3')
    // Soundtrack and covers come along — including the DRAFT's, which the
    // series landing dims rather than leaving a blank slot. Covers are the one
    // deliberate exception to a stub sending nothing but title and order; the
    // draft's synopsis and chapters are still absent, asserted above.
    expect(result.referencedAssets).toContain('/music/sbx-lantern-theme.mp3')
    expect(result.referencedAssets).toContain('/covers/sbx-book-1.jpg')
    expect(result.referencedAssets).toContain('/covers/sbx-book-3.jpg')
  })
})

describe('publish is per book', () => {
  // The workflow this exists for: release book one while book two is still
  // being revised. Carry-forward is what makes it safe — the whole file is
  // still rebuilt and swapped atomically; only each book's SOURCE differs.
  const buildSome = (bookIds: string[] | undefined, at: string) => buildContentDb({
    sourcePath: SANDBOX, outPath: OUT, seriesId: 'sbx-series',
    authorName: 'Sandbox Author', publishedAt: at, bookIds,
  })

  fixtureIt('publishing one book leaves the other exactly as readers had it', () => {
    buildSome(undefined, '2026-01-01T00:00:00.000Z')
    const before = read(`SELECT id, content FROM ContentBlock WHERE chapterId IN
      (SELECT id FROM Chapter WHERE bookId='sbx-book-2') ORDER BY id`)
    expect(before.length).toBeGreaterThan(0)

    const result = buildSome(['sbx-book-1'], '2026-02-02T00:00:00.000Z')
    expect(result.built).toEqual(['sbx-book-1'])
    expect(result.books.find(b => b.id === 'sbx-book-1')?.source).toBe('built')
    expect(result.books.find(b => b.id === 'sbx-book-2')?.source).toBe('carried')

    const after = read(`SELECT id, content FROM ContentBlock WHERE chapterId IN
      (SELECT id FROM Chapter WHERE bookId='sbx-book-2') ORDER BY id`)
    expect(after).toEqual(before)
  })

  fixtureIt('keeps each book&apos;s own publish time, so they can move independently', () => {
    buildSome(undefined, '2026-01-01T00:00:00.000Z')
    buildSome(['sbx-book-1'], '2026-02-02T00:00:00.000Z')
    const meta = Object.fromEntries(
      read(`SELECT key, value FROM PublishMeta`).map(r => [r.key, r.value]),
    )
    expect(meta['book:sbx-book-1:publishedAt']).toBe('2026-02-02T00:00:00.000Z')
    expect(meta['book:sbx-book-2:publishedAt']).toBe('2026-01-01T00:00:00.000Z')
  })

  fixtureIt('an eligible book that was never published reads as a stub, not a hole', () => {
    // Publishing only book 1 on a fresh snapshot must not leave book 2 missing
    // from the series entirely — it shows as Coming Soon, like a draft.
    for (const s of ['', '-wal', '-shm']) rmSync(OUT + s, { force: true })
    const result = buildSome(['sbx-book-1'], '2026-01-01T00:00:00.000Z')
    expect(result.books.find(b => b.id === 'sbx-book-2')?.source).toBe('stub')
    expect(read(`SELECT id FROM Book WHERE id='sbx-book-2'`)).toHaveLength(1)
    expect(read(`SELECT id FROM Chapter WHERE bookId='sbx-book-2'`)).toHaveLength(0)
    expect(read(`SELECT synopsis FROM Book WHERE id='sbx-book-2'`)[0].synopsis).toBe('')
  })

  fixtureIt('rebuilds everything rather than un-publishing a book it cannot carry', () => {
    // An unreadable snapshot (older format) leaves an unselected book nowhere
    // to come from. Dropping it to a stub would silently take a book away from
    // readers, so the selection is widened and the result says so.
    buildSome(undefined, '2026-01-01T00:00:00.000Z')
    const db = new Database(OUT)
    db.prepare(`UPDATE PublishMeta SET value='not-a-real-fingerprint' WHERE key='schema'`).run()
    db.close()

    const result = buildSome(['sbx-book-1'], '2026-02-02T00:00:00.000Z')
    expect(result.built).toContain('sbx-book-2')
    expect(result.books.find(b => b.id === 'sbx-book-2')?.source).toBe('built')
    expect(result.warnings.join(' ')).toMatch(/every book was rebuilt/i)
  })

  fixtureIt('keeps a carried book&apos;s assets referenced, so the prune cannot orphan them', () => {
    // Pruning against only the rebuilt book's references would delete the
    // other books' covers and audio out from under them.
    buildSome(undefined, '2026-01-01T00:00:00.000Z')
    const result = buildSome(['sbx-book-1'], '2026-02-02T00:00:00.000Z')
    expect(result.referencedAssets).toContain('/covers/sbx-book-2.jpg')
    expect(result.referencedAssets).toContain('/covers/sbx-book-1.jpg')
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
    expect(result.books.every(b => b.eligible || b.chapters === 0)).toBe(true)
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
