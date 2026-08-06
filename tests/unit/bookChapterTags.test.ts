import { groupBookChapterTags, matchGaps, type ChapterIn, type TagRow } from '@/lib/bookChapterTags'

// LOOM-120/121. The cases that matter here are the ones the Outline tab gets
// wrong by construction: a branch chapter has no canon number and no outline
// card, and must still appear, in place, under its authored title.

const ch = (id: string, title: string, order: number): ChapterIn => ({ id, title, order })
const tag = (chapterId: string, entityId: string, nonCanon = false): TagRow => ({
  chapterId,
  entityId,
  nonCanon,
})

// A book shaped like the real ones: a prologue, canon chapters, and a
// branch-gated bonus chapter sitting between two of them.
const CHAPTERS = [
  ch('c0', 'Prologue', 1),
  ch('c1', 'Chapter 1', 2),
  ch('c2', 'Bonus Chapter 1', 3),
  ch('c3', 'Chapter 2', 4),
]
// The canon walk reaches everything but the bonus chapter, which is ABSENT
// from the map rather than mapped to null.
const NUMBERS = new Map<string, number | null>([
  ['c0', 0],
  ['c1', 1],
  ['c3', 2],
])

describe('groupBookChapterTags', () => {
  it('keeps the branch chapter, in place, under its authored title', () => {
    const rows = groupBookChapterTags(CHAPTERS, [], [], NUMBERS)

    expect(rows.map(r => r.title)).toEqual(['Prologue', 'Chapter 1', 'Bonus Chapter 1', 'Chapter 2'])
    // Third in the sequence, not appended at the end and not dropped — the
    // whole failure mode of sourcing this view from the canon-only outline.
    expect(rows[2].chapterId).toBe('c2')
  })

  it('marks the branch chapter off-canon and gives it no number', () => {
    const rows = groupBookChapterTags(CHAPTERS, [], [], NUMBERS)

    expect(rows[2]).toMatchObject({ title: 'Bonus Chapter 1', offCanon: true, chapterNumber: null })
    expect(rows.filter(r => r.offCanon)).toHaveLength(1)
  })

  it('distinguishes "no canon number" from "not on the canon path"', () => {
    // A named chapter the walk DOES visit: in the map, mapped to null. It must
    // not be badged as branch content just because it has no number.
    const numbers = new Map<string, number | null>([...NUMBERS, ['c2', null]])
    const rows = groupBookChapterTags(CHAPTERS, [], [], numbers)

    expect(rows[2]).toMatchObject({ chapterNumber: null, offCanon: false })
  })

  it('orders by Chapter.order, not by canon number', () => {
    // Canon numbering skips the bonus chapter, so ordering by it would move or
    // drop the chapter. Shuffled input, to prove the sort is doing the work.
    const shuffled = [CHAPTERS[3], CHAPTERS[0], CHAPTERS[2], CHAPTERS[1]]
    const rows = groupBookChapterTags(shuffled, [], [], NUMBERS)

    expect(rows.map(r => r.order)).toEqual([1, 2, 3, 4])
  })

  it('attaches character and event tags to their own chapters', () => {
    const rows = groupBookChapterTags(
      CHAPTERS,
      [tag('c1', 'wc-chase'), tag('c2', 'wc-chase'), tag('c3', 'wc-emma')],
      [tag('c1', 'we-heist')],
      NUMBERS,
    )

    expect(rows[1].characters).toEqual([{ id: 'wc-chase', nonCanon: false }])
    expect(rows[1].events).toEqual([{ id: 'we-heist', nonCanon: false }])
    expect(rows[2].characters).toEqual([{ id: 'wc-chase', nonCanon: false }])
    expect(rows[3].characters).toEqual([{ id: 'wc-emma', nonCanon: false }])
    expect(rows[0].characters).toEqual([])
  })

  it('carries the non-canon tag flag through', () => {
    // A branch appearance INSIDE an otherwise canon chapter — distinct from
    // the chapter itself being off-canon, and both can be true at once.
    const rows = groupBookChapterTags(CHAPTERS, [tag('c1', 'wc-chase', true)], [], NUMBERS)

    expect(rows[1]).toMatchObject({ offCanon: false })
    expect(rows[1].characters).toEqual([{ id: 'wc-chase', nonCanon: true }])
  })

  it('gives every chapter a tag list, including untagged ones', () => {
    // An empty array is a meaningful answer ("nobody tagged here"); a missing
    // key would make the view guess between that and a lookup failure.
    const rows = groupBookChapterTags(CHAPTERS, [], [], NUMBERS)

    expect(rows.every(r => Array.isArray(r.characters) && Array.isArray(r.events))).toBe(true)
  })

  it('ignores tags for chapters outside the book', () => {
    const rows = groupBookChapterTags(CHAPTERS, [tag('c-elsewhere', 'wc-chase')], [], NUMBERS)

    expect(rows.flatMap(r => r.characters)).toEqual([])
  })

  it('collapses a duplicate tag, and canon wins over branch', () => {
    // Two rows for one pair should not render as two chips, and if either says
    // canon the appearance IS canon — "happens in the real story" is the
    // weaker claim to discard.
    const rows = groupBookChapterTags(
      CHAPTERS,
      [tag('c1', 'wc-chase', true), tag('c1', 'wc-chase', false)],
      [],
      NUMBERS,
    )

    expect(rows[1].characters).toEqual([{ id: 'wc-chase', nonCanon: false }])
  })
})

describe('matchGaps', () => {
  const rows = groupBookChapterTags(
    CHAPTERS,
    [tag('c1', 'wc-chase'), tag('c2', 'wc-chase')],
    [],
    NUMBERS,
  )
  const hasChase = (r: (typeof rows)[number]) => r.characters.some(c => c.id === 'wc-chase')

  it('counts the run before each match, including the leading one', () => {
    // Chase is in c1 and c2. One chapter (the prologue) precedes the first
    // match; none separates the two matches.
    expect(matchGaps(rows, hasChase)).toEqual([1, 0])
  })

  it('returns nothing when nothing matches', () => {
    expect(matchGaps(rows, () => false)).toEqual([])
  })

  it('does not count the trailing run', () => {
    // Chapters after the LAST match are not a gap between appearances, and
    // reporting them as one would read as a missing chapter.
    expect(matchGaps(rows, r => r.chapterId === 'c0')).toEqual([0])
  })
})
