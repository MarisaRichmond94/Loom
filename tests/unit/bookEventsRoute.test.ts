import { readFileSync } from 'fs'
import path from 'path'
import { groupBookEvents, type BookTagRow } from '@/lib/chapterEvents'

// Sibling of chapterEventsRoute.test.ts (LOOM-101).
//
// Same hazard, second route: GET /api/series/[id]/books/[id]/events runs on
// every render of the book page's Timeline tab. Resolving chapter numbers via
// the canon EXPORT instead of the canon WALK would return identical numbers
// while writing .pages/.txt/.docx to ~/Writing as a side effect — rewriting the
// manuscript on every page load and kicking off a WriteAI ingest each time.
//
// Pinned at source level because the failure is invisible from the response.
// The existing guard exists precisely because a comment did not stop it the
// first time.
const routeSrc = readFileSync(
  path.join(__dirname, '../../src/app/api/series/[seriesId]/books/[bookId]/events/route.ts'),
  'utf8',
)

describe('GET book events stays read-only', () => {
  // Everything the canon export route pulls in to write manuscript files.
  const writers = [
    'fs/promises',
    'writeFile',
    'mkdir',
    'buildManuscriptDocx',
    'docxToPages',
    'export/canon',
    'canonManifest',
  ]

  it.each(writers)('does not reference %s', token => {
    expect(routeSrc).not.toContain(token)
  })

  it('resolves numbers through the read-only canon walk', () => {
    expect(routeSrc).toContain('canonNumbersForBook')
  })
})

// The mirror image of the chapter-events seam rule (LOOM-78 / LOOM-101).
//
// That route MUST filter non-canon; this one MUST NOT. Getting it backwards
// here would silently empty the branch-only badge (LOOM-107) — the timeline
// would look correct and simply never mark anything.
describe('GET book events keeps non-canon tags', () => {
  it('does not filter nonCanon in the query', () => {
    const where = routeSrc.slice(routeSrc.indexOf('findMany'), routeSrc.indexOf('// A book with'))
    expect(where).not.toContain('nonCanon: false')
  })

  it('selects the flag so the client can badge it', () => {
    expect(routeSrc).toContain('nonCanon: true')
  })
})

describe('groupBookEvents', () => {
  const numbers = new Map<string, number | null>([
    ['c1', 1],
    ['c2', 2],
    ['c3', null],
    ['c0', 0],
  ])

  const row = (id: string, chapterId: string, title: string, nonCanon = false): BookTagRow => ({
    writerEventId: id,
    chapterId,
    nonCanon,
    chapter: { title },
  })

  it('collapses an event tagged in several chapters into one entry', () => {
    const out = groupBookEvents(
      [row('we-1', 'c1', 'One'), row('we-1', 'c2', 'Two')],
      numbers,
    )
    expect(out).toHaveLength(1)
    expect(out[0].appearances.map(a => a.chapterId)).toEqual(['c1', 'c2'])
  })

  it('orders by canon number with unnumbered chapters last', () => {
    // Deliberately fed out of order, and with the prologue present: an
    // unnumbered chapter sorting as 0 would jump ahead of it.
    const out = groupBookEvents(
      [
        row('we-1', 'c3', 'Unnumbered'),
        row('we-1', 'c2', 'Two'),
        row('we-1', 'c0', 'Prologue'),
        row('we-1', 'c1', 'One'),
      ],
      numbers,
    )
    expect(out[0].appearances.map(a => a.chapterId)).toEqual(['c0', 'c1', 'c2', 'c3'])
  })

  it('reports a chapter missing from the walk as unnumbered rather than dropping it', () => {
    const out = groupBookEvents([row('we-1', 'unknown', 'Ghost')], numbers)
    expect(out[0].appearances).toEqual([
      { chapterId: 'unknown', chapterTitle: 'Ghost', chapterNumber: null, nonCanon: false },
    ])
  })

  it('keeps non-canon tags, flagged', () => {
    const out = groupBookEvents([row('we-1', 'c1', 'One', true)], numbers)
    expect(out[0].appearances[0].nonCanon).toBe(true)
  })

  it('preserves a mix, so an event canon in one chapter and branch-only in another is not collapsed to either', () => {
    // The case LOOM-107's badge turns on: all-non-canon means branch-only,
    // mixed means canon. Losing either flag here would decide it wrongly.
    const out = groupBookEvents(
      [row('we-1', 'c1', 'One', false), row('we-1', 'c2', 'Two', true)],
      numbers,
    )
    expect(out[0].appearances.map(a => a.nonCanon)).toEqual([false, true])
  })

  it('returns nothing for no rows', () => {
    expect(groupBookEvents([], numbers)).toEqual([])
  })
})
