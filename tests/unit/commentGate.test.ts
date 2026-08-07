import { hasFinishedChapter, type GateInput } from '@shared/commentGate'

// The spoiler gate (LOOM-134).
//
// This is the highest-consequence logic in the reader tier, and its failure is
// silent and permanent: a comment on chapter 7 that mentions chapter 12, shown
// to someone on chapter 7. Nothing errors, nothing looks wrong, and the book is
// spoiled for a member of the author's family — which cannot be undone.
//
// So the bias throughout is FAIL CLOSED. A wrong "no" costs a click later; a
// wrong "yes" costs the thing the whole feature exists to protect.

const BOOK = ['c1', 'c2', 'c3', 'c4']

const gate = (over: Partial<GateInput>): boolean =>
  hasFinishedChapter({
    chapterIds: BOOK,
    chapterId: 'c2',
    atChapterId: 'c2',
    atOffset: 0,
    paragraphCount: 10,
    ...over,
  })

describe('having moved on counts as having finished', () => {
  it('opens a chapter you are past', () => {
    expect(gate({ atChapterId: 'c3' })).toBe(true)
    expect(gate({ atChapterId: 'c4' })).toBe(true)
  })

  it('stays shut on a chapter you have not reached', () => {
    expect(gate({ chapterId: 'c3', atChapterId: 'c2', atOffset: 999 })).toBe(false)
  })
})

describe('within the chapter you are reading', () => {
  it('stays shut at the top', () => {
    expect(gate({ atOffset: 0 })).toBe(false)
  })

  it('stays shut in the middle', () => {
    expect(gate({ atOffset: 5, paragraphCount: 10 })).toBe(false)
  })

  it('opens at the last paragraph', () => {
    expect(gate({ atOffset: 9, paragraphCount: 10 })).toBe(true)
  })

  it('stays shut near the end, before the end is actually reached', () => {
    // Deliberately NOT slack for viewport height. Reaching the end is an
    // explicit signal from the recorder, so "nearly there" is still not there.
    expect(gate({ atOffset: 8, paragraphCount: 10 })).toBe(false)
  })

  it('opens on the recorder’s explicit end signal', () => {
    // The recorder writes `count` — one past the last index — when the end of
    // the prose comes into view. That is what a finished chapter looks like.
    expect(gate({ atOffset: 10, paragraphCount: 10 })).toBe(true)
  })

  it('tolerates the two paragraph counters disagreeing by one', () => {
    // The client counts rendered <p>; the server counts them in stored HTML.
    // A one-off between them must not lock out a reader who finished.
    expect(gate({ atOffset: 9, paragraphCount: 10 })).toBe(true)
  })

  it('treats a chapter with no prose as finished', () => {
    expect(gate({ atOffset: 0, paragraphCount: 0 })).toBe(true)
  })
})

describe('it fails closed', () => {
  it('refuses a reader who has never started the book', () => {
    expect(gate({ atChapterId: null })).toBe(false)
  })

  it('refuses when the requested chapter is not in the published order', () => {
    // An orphaned comment thread, or a URL for a chapter that was unpublished.
    // "Not reasonable about" must mean no, never yes.
    expect(gate({ chapterId: 'gone' })).toBe(false)
  })

  it('refuses when the viewer’s own position is on a vanished chapter', () => {
    // Their progress points at a chapter that no longer exists, so we cannot
    // place them in the order at all. Without a position we cannot say they
    // are past anything.
    expect(gate({ atChapterId: 'gone', atOffset: 999 })).toBe(false)
  })

  it('does not let a large offset substitute for being in the right chapter', () => {
    // The dangerous shortcut: reading offset without first checking WHICH
    // chapter it belongs to. Offset 999 in chapter 1 is not the end of
    // chapter 4.
    expect(gate({ chapterId: 'c4', atChapterId: 'c1', atOffset: 999 })).toBe(false)
  })
})

describe('the realistic household spoiler', () => {
  it('does not show mum’s chapter-7 comments to someone still in chapter 7', () => {
    const chapters = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
    // Dan is a third of the way through chapter 7. Mum is on chapter 12 and
    // commented on 7 with everything she now knows.
    expect(hasFinishedChapter({
      chapterIds: chapters,
      chapterId: 'c7',
      atChapterId: 'c7',
      atOffset: 12,
      paragraphCount: 40,
    })).toBe(false)
  })

  it('shows them the moment he turns the page', () => {
    const chapters = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
    expect(hasFinishedChapter({
      chapterIds: chapters,
      chapterId: 'c7',
      atChapterId: 'c8',
      atOffset: 0,
      paragraphCount: 40,
    })).toBe(true)
  })

  it('is not defeated by jumping to a chapter directly', () => {
    // The TOC jump / direct URL case the ticket calls out by name. Opening
    // chapter 7 does not make its comments readable; finishing it does.
    expect(gate({ chapterId: 'c4', atChapterId: 'c1', atOffset: 0 })).toBe(false)
  })
})
