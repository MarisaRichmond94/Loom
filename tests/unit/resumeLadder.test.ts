import { resolveResume, resumeNotice, type ChapterRef } from '@shared/resumeLadder'

// Dangling reading positions (LOOM-133).
//
// The ladder the author chose:
//   1. chapter still there        → resume at offset
//   2. chapter gone               → start of the previous chapter
//   3. no usable previous chapter → start of the book
//   4. book gone                  → nothing
//
// The reason this is pinned so heavily is that EVERY wrong answer here still
// renders a perfectly good chapter. There is no crash to notice — just a reader
// quietly returned to the wrong place, or worse, shown a chapter they had not
// reached yet.

const chapters = (...ids: string[]): ChapterRef[] => ids.map(id => ({ id }))
const BOOK = chapters('c1', 'c2', 'c3', 'c4')

describe('1. the chapter is still published', () => {
  it('resumes exactly where they were', () => {
    expect(resolveResume(BOOK, { chapterId: 'c3', offset: 42, prevChapterId: 'c2' }))
      .toEqual({ kind: 'exact', chapterId: 'c3', offset: 42 })
  })

  it('never returns a negative offset', () => {
    expect(resolveResume(BOOK, { chapterId: 'c3', offset: -5, prevChapterId: 'c2' }))
      .toEqual({ kind: 'exact', chapterId: 'c3', offset: 0 })
  })
})

describe('2. the chapter was removed', () => {
  it('drops to the start of the chapter before it', () => {
    // c3 unpublished; the position recorded c2 as its predecessor.
    expect(resolveResume(chapters('c1', 'c2', 'c4'), {
      chapterId: 'c3', offset: 900, prevChapterId: 'c2',
    })).toEqual({ kind: 'previous', chapterId: 'c2', offset: 0 })
  })

  it('discards the offset — it described a chapter that no longer exists', () => {
    const r = resolveResume(chapters('c1', 'c2'), {
      chapterId: 'c3', offset: 900, prevChapterId: 'c2',
    })
    expect(r).toMatchObject({ offset: 0 })
  })

  it('falls back to the book start when the predecessor is gone too', () => {
    // Deliberately NOT chained. Walking further back would be guessing with a
    // history we no longer have.
    expect(resolveResume(chapters('c1', 'c4'), {
      chapterId: 'c3', offset: 10, prevChapterId: 'c2',
    })).toEqual({ kind: 'restart', chapterId: 'c1', offset: 0 })
  })
})

describe('3. no usable predecessor', () => {
  it('restarts when they were in the first chapter', () => {
    expect(resolveResume(chapters('c2', 'c3'), {
      chapterId: 'c1', offset: 30, prevChapterId: null,
    })).toEqual({ kind: 'restart', chapterId: 'c2', offset: 0 })
  })

  it('starts a never-opened book at the beginning', () => {
    expect(resolveResume(BOOK, { chapterId: null, offset: 0, prevChapterId: null }))
      .toEqual({ kind: 'restart', chapterId: 'c1', offset: 0 })
  })
})

describe('4. the book is gone', () => {
  it('surfaces nothing rather than inventing a position', () => {
    expect(resolveResume([], { chapterId: 'c3', offset: 42, prevChapterId: 'c2' }))
      .toEqual({ kind: 'gone' })
  })
})

describe('resolution is by id, never by position', () => {
  // The ticket names this explicitly, and it is the WriteAI stale identity-map
  // failure in miniature: an id↔number check passes while text and id have
  // divorced, so the answer looks right and is wrong.

  it('survives a chapter being INSERTED before the saved one', () => {
    // c3 is now the fourth chapter rather than the third. Nothing about the
    // reader's position changed, and a number-based resolver would move them.
    const after = chapters('c1', 'c1a', 'c2', 'c3', 'c4')
    expect(resolveResume(after, { chapterId: 'c3', offset: 42, prevChapterId: 'c2' }))
      .toEqual({ kind: 'exact', chapterId: 'c3', offset: 42 })
  })

  it('survives every chapter being renumbered by an unpublish earlier in the book', () => {
    const after = chapters('c2', 'c3', 'c4')
    expect(resolveResume(after, { chapterId: 'c4', offset: 7, prevChapterId: 'c3' }))
      .toEqual({ kind: 'exact', chapterId: 'c4', offset: 7 })
  })

  it('does not match a chapter merely because it sits where the old one did', () => {
    // c3 deleted, and some other chapter now occupies index 2. Landing there
    // would hand the reader prose they have not reached.
    const after = chapters('c1', 'c2', 'cX', 'c4')
    const r = resolveResume(after, { chapterId: 'c3', offset: 42, prevChapterId: 'c2' })
    expect(r).toEqual({ kind: 'previous', chapterId: 'c2', offset: 0 })
    expect(r).not.toMatchObject({ chapterId: 'cX' })
  })
})

describe('the reader is told when they were moved', () => {
  it('says nothing on an exact resume', () => {
    expect(resumeNotice({ kind: 'exact', chapterId: 'c3', offset: 5 }, true)).toBeNull()
  })

  it('explains a drop to the previous chapter', () => {
    expect(resumeNotice({ kind: 'previous', chapterId: 'c2', offset: 0 }, true))
      .toMatch(/revised/)
  })

  it('says nothing to someone opening a book for the first time', () => {
    // Same `restart` shape as a relocation, and telling a first-time reader
    // their chapter "was revised" would simply be false.
    expect(resumeNotice({ kind: 'restart', chapterId: 'c1', offset: 0 }, false)).toBeNull()
    expect(resumeNotice({ kind: 'restart', chapterId: 'c1', offset: 0 }, true)).toMatch(/revised/)
  })
})
