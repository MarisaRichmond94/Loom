import { readFileSync } from 'fs'
import path from 'path'
import { isBranchOnly } from '@/components/timeline/TimelineSection'
import { groupSeriesEvents, type SeriesTagRow } from '@/lib/chapterEvents'

// The branch-only badge (LOOM-107).
//
// Worth testing rather than eyeballing: the rule has three cases that all look
// alike from the outside, and getting one wrong produces a timeline that is
// confidently mislabelled rather than visibly broken.

describe('isBranchOnly', () => {
  const at = (chapterId: string, nonCanon: boolean) => ({
    chapterId,
    chapterTitle: chapterId,
    chapterNumber: 1,
    nonCanon,
  })

  it('badges an event referenced only on branches', () => {
    expect(isBranchOnly([at('c1', true), at('c2', true)])).toBe(true)
  })

  it('does NOT badge a mixed event — canon anywhere means canon', () => {
    // The case most likely to be got wrong. The badge answers "does this
    // happen in the real story"; referenced canonically in even one chapter
    // means yes, whatever the other tags say.
    expect(isBranchOnly([at('c1', false), at('c2', true)])).toBe(false)
  })

  it('does not badge a purely canon event', () => {
    expect(isBranchOnly([at('c1', false)])).toBe(false)
  })

  it('does not badge an event with no appearances at all', () => {
    // Untagged is NEITHER: the event exists in WriteAI and is referenced
    // nowhere in Loom. Badging it would claim something about a story that
    // never mentions it.
    expect(isBranchOnly([])).toBe(false)
  })
})

describe('branch-only is scope-dependent', () => {
  // The trap the ticket calls out: an event branch-only in book 2 but canon in
  // book 4 must badge on book 2's tab and NOT on the series tab. Same event,
  // two correct answers, decided entirely by which appearances are passed in.
  const inBook2 = [
    { chapterId: 'b2c1', chapterTitle: 'Ch 1', chapterNumber: 1, nonCanon: true },
  ]
  const inBook4 = [
    { chapterId: 'b4c7', chapterTitle: 'Ch 7', chapterNumber: 7, nonCanon: false },
  ]

  it('badges on the book tab where every tag is branch-only', () => {
    expect(isBranchOnly(inBook2)).toBe(true)
  })

  it('does not badge on the series tab, where the canon tag is also in view', () => {
    expect(isBranchOnly([...inBook2, ...inBook4])).toBe(false)
  })
})

describe('groupSeriesEvents', () => {
  const row = (
    writerEventId: string,
    chapterId: string,
    bookOrder: number,
    chapterNumber: number,
    nonCanon = false,
  ): SeriesTagRow => ({
    writerEventId,
    chapterId,
    nonCanon,
    chapter: {
      title: `Chapter ${chapterNumber}`,
      bookId: `book-${bookOrder}`,
      book: { title: `Book ${bookOrder}`, order: bookOrder },
    },
  })

  const numbers = new Map<string, number | null>([
    ['b1c1', 1],
    ['b1c9', 9],
    ['b3c2', 2],
  ])

  it('carries book identity, which the book-scoped grouping omits', () => {
    const [event] = groupSeriesEvents([row('we-1', 'b1c1', 1, 1)], numbers)
    expect(event.appearances[0]).toMatchObject({
      bookId: 'book-1',
      bookTitle: 'Book 1',
      bookOrder: 1,
    })
  })

  it('orders by book before chapter', () => {
    // Fed book 3 first: sorting by chapter number alone would put b3c2 ahead
    // of b1c9, which reads as the event happening in book 3 first.
    const [event] = groupSeriesEvents(
      [row('we-1', 'b3c2', 3, 2), row('we-1', 'b1c9', 1, 9), row('we-1', 'b1c1', 1, 1)],
      numbers,
    )
    expect(event.appearances.map(a => a.chapterId)).toEqual(['b1c1', 'b1c9', 'b3c2'])
  })

  it('collapses one event across books into a single entry', () => {
    const out = groupSeriesEvents(
      [row('we-1', 'b1c1', 1, 1), row('we-1', 'b3c2', 3, 2)],
      numbers,
    )
    expect(out).toHaveLength(1)
    expect(out[0].appearances).toHaveLength(2)
  })
})

// Same read-only hazard as its two siblings — see chapterEventsRoute.test.ts.
// This route runs on every render of the series Timeline tab, and resolving
// numbers through the canon EXPORT would rewrite the manuscript each time
// while returning identical output.
describe('GET series events stays read-only', () => {
  const routeSrc = readFileSync(
    path.join(__dirname, '../../src/app/api/series/[seriesId]/events/route.ts'),
    'utf8',
  )

  it.each([
    'fs/promises',
    'writeFile',
    'mkdir',
    'buildManuscriptDocx',
    'docxToPages',
    'export/canon',
    'canonManifest',
  ])('does not reference %s', token => {
    expect(routeSrc).not.toContain(token)
  })

  it('resolves numbers through the read-only canon walk', () => {
    expect(routeSrc).toContain('canonNumbersForBook')
  })

  it('keeps non-canon tags — this is the Loom-facing route', () => {
    const where = routeSrc.slice(routeSrc.indexOf('findMany'), routeSrc.indexOf('if (rows.length'))
    expect(where).not.toContain('nonCanon: false')
  })
})
