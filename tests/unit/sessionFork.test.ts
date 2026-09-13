import { shouldFork, qualifyingBookIds, isRewind, forkPointOf } from '@/lib/sessionFork'
import type { BookIn } from '@/lib/chapterLabels'

// LOOM-154, under LOOM-146. Rewinding used to truncate choiceHistory in place,
// so the branch being left was overwritten — exploring the other option cost you
// the one you were on. It now forks, but ONLY when the rewind crosses a branch
// boundary; forking on every rewind would spawn a session for every "let me see
// the other option" poke.

const gate = (v: boolean) => JSON.stringify({ diverged: v })

const series: BookIn[] = [
  { id: 'b1', title: 'One', order: 1, canon: true, chapters: [] },
  { id: 'b2', title: 'Two', order: 2, canon: true, chapters: [] },
  { id: 'b3', title: 'Three', order: 3, canon: true, condition: gate(false), chapters: [] },
  { id: 'alt', title: 'Undertow', order: 9, canon: false, condition: gate(true), chapters: [] },
]

describe('qualifyingBookIds', () => {
  it('is the set of books a state opens', () => {
    expect(qualifyingBookIds(series, { diverged: false })).toEqual(['b1', 'b2', 'b3'])
    expect(qualifyingBookIds(series, { diverged: true })).toEqual(['alt', 'b1', 'b2'])
  })
})

describe('shouldFork', () => {
  it('forks when the rewind un-diverges the reader', () => {
    expect(shouldFork(series, { diverged: true }, { diverged: false })).toBe(true)
  })

  it('forks in the other direction too', () => {
    expect(shouldFork(series, { diverged: false }, { diverged: true })).toBe(true)
  })

  it('does NOT fork a rewind within the same branch', () => {
    // A rewind that changes a variable nothing gates a book on. This is the
    // common case — "let me see the other option" — and forking here would fill
    // Continue Reading with near-identical entries.
    expect(shouldFork(series, { diverged: false, mood: 'grim' }, { diverged: false, mood: 'calm' }))
      .toBe(false)
  })

  it('does not fork when no book is gated at all', () => {
    const ungated = series.map(b => ({ ...b, condition: null }))
    expect(shouldFork(ungated, { diverged: true }, { diverged: false })).toBe(false)
  })

  it('detects a SWAP, where the set size is unchanged', () => {
    // The case the whole feature exists for: canon book 3 out, alt book in.
    // Comparing counts rather than membership would miss it entirely — both
    // sides have three books.
    const before = qualifyingBookIds(series, { diverged: false })
    const after = qualifyingBookIds(series, { diverged: true })
    expect(before).toHaveLength(after.length)
    expect(shouldFork(series, { diverged: false }, { diverged: true })).toBe(true)
  })

  it('is order-insensitive', () => {
    // qualifyingBookIds sorts, so a reordering of the same books is not a fork.
    const shuffled = [...series].reverse()
    expect(shouldFork(shuffled, { diverged: false }, { diverged: false })).toBe(false)
  })
})

describe('isRewind', () => {
  // choiceHistory only ever shrinks via a rewind — ReaderView documents this
  // invariant and relies on it. That is why no new request field is needed.
  it('is true when the history got shorter', () => {
    expect(isRewind([1, 2, 3], [1])).toBe(true)
  })

  it('is false for an ordinary forward choice', () => {
    expect(isRewind([1, 2], [1, 2, 3])).toBe(false)
  })

  it('is false for a same-length update', () => {
    expect(isRewind([1, 2], [1, 2])).toBe(false)
  })
})

describe('forkPointOf', () => {
  const history = [
    { choicePointId: 'cp1' },
    { choicePointId: 'cp2' },
    { choicePointId: 'cp3' },
  ]

  it('names the first choice point dropped — the one being re-answered', () => {
    // NOT the last kept choice: that is identical in both branches, so it says
    // nothing about what separates them.
    expect(forkPointOf(history, ['kept'])).toBe('cp2')
  })

  it('names the very first choice when everything is dropped', () => {
    expect(forkPointOf(history, [])).toBe('cp1')
  })

  it('is null when nothing was dropped', () => {
    expect(forkPointOf(history, [1, 2, 3])).toBeNull()
  })
})
