import {
  isBookVisible,
  computeBookLabels,
  computeChapterLabels,
  type BookIn,
} from '@/lib/chapterLabels'

// LOOM-151, under LOOM-146. Book.condition is Chapter.condition lifted one
// level: which BOOKS a reader can see is path-dependent, and canon is simply
// the set the DEFAULT story state selects.
//
// The fixture throughout is the real shape this exists for: books 1-3 ungated,
// then a fork after book 3 into canon book 4 (`diverged` false) and an alt book
// (`diverged` true) that sorts beneath every canon book.

const gate = (value: boolean) => JSON.stringify({ diverged: value })

const series: BookIn[] = [
  { id: 'b1', title: 'One', order: 1, canon: true, chapters: [] },
  { id: 'b2', title: 'Two', order: 2, canon: true, chapters: [] },
  { id: 'b3', title: 'Three', order: 3, canon: true, chapters: [] },
  { id: 'b4', title: 'Four', order: 4, canon: true, condition: gate(false), chapters: [] },
  { id: 'alt', title: 'Undertow', order: 5, canon: false, condition: gate(true), chapters: [] },
]

const visibleIds = (state: Record<string, string | number | boolean>) =>
  series.filter(b => isBookVisible(b, state)).map(b => b.id)

describe('isBookVisible', () => {
  it('shows an ungated book to everyone', () => {
    expect(isBookVisible(series[0], {})).toBe(true)
    expect(isBookVisible(series[0], { diverged: true })).toBe(true)
  })

  it('THE INVARIANT: the default state selects exactly the canon books', () => {
    // The epic rests on this. If it were false, canon book 4 would still export
    // to ~/Writing and publish to readers while being unreachable to every
    // reader — a divergence between what ships and what is readable, with no
    // symptom. LOOM-155 checks it against real series data; this pins the rule.
    expect(visibleIds({ diverged: false })).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('swaps the book set when the reader diverges', () => {
    expect(visibleIds({ diverged: true })).toEqual(['b1', 'b2', 'b3', 'alt'])
  })

  it('shows a book whose gate is unparseable rather than hiding it', () => {
    // Mirrors isChapterVisible exactly. Hiding a chunk of the story because a
    // gate failed to parse is far worse than showing one that should have been
    // gated — and the second is visible, while the first is not.
    const broken: BookIn = { id: 'x', title: 'X', order: 9, chapters: [], condition: '{ not json' }
    expect(isBookVisible(broken, {})).toBe(true)
  })
})

describe('computeBookLabels', () => {
  it('numbers canon books and labels non-canon ones "Alt"', () => {
    const labels = computeBookLabels(series, { diverged: false })
    expect(labels.b3.readerLabel).toBe('Book 3')
    expect(labels.b4.readerLabel).toBe('Book 4')
    expect(labels.alt.readerLabel).toBe('Alt')
  })

  it('NUMBERS DO NOT MOVE when the reader diverges', () => {
    // The whole reason numbering counts canon books rather than visible ones.
    // Under a visible-book counter the alt book would become "Book 4" and a
    // reader who rewound would watch Book 4 turn into a different book.
    const canon = computeBookLabels(series, { diverged: false })
    const alt = computeBookLabels(series, { diverged: true })
    for (const id of ['b1', 'b2', 'b3', 'b4', 'alt']) {
      expect(alt[id].readerLabel).toBe(canon[id].readerLabel)
    }
  })

  it('still reports visibility, so callers can filter', () => {
    const labels = computeBookLabels(series, { diverged: true })
    expect(labels.b4.visible).toBe(false)
    expect(labels.alt.visible).toBe(true)
  })

  it('emits an entry for every book, including hidden ones', () => {
    const labels = computeBookLabels(series, { diverged: true })
    expect(Object.keys(labels).sort()).toEqual(['alt', 'b1', 'b2', 'b3', 'b4'])
  })
})

describe('computeChapterLabels respects the book gate', () => {
  const withChapters: BookIn[] = [
    {
      id: 'b4', title: 'Four', order: 4, canon: true, condition: gate(false),
      chapters: [{ id: 'b4c1', title: 'A', order: 1, numbered: true }],
    },
    {
      id: 'alt', title: 'Undertow', order: 5, canon: false, condition: gate(true),
      chapters: [{ id: 'altc1', title: 'B', order: 1, numbered: true }],
    },
  ]

  it('hides chapters of a book the reader does not qualify for', () => {
    const canon = computeChapterLabels(withChapters, { diverged: false })
    expect(canon.b4c1.visible).toBe(true)
    expect(canon.altc1.visible).toBe(false)

    const diverged = computeChapterLabels(withChapters, { diverged: true })
    expect(diverged.b4c1.visible).toBe(false)
    expect(diverged.altc1.visible).toBe(true)
  })

  it('still emits an entry for every chapter', () => {
    const labels = computeChapterLabels(withChapters, { diverged: true })
    expect(Object.keys(labels).sort()).toEqual(['altc1', 'b4c1'])
  })
})

// ── The ordering rule the author's series list applies (LOOM-151/152) ────────
//
// Mirrors the sort in author/[seriesId]/page.tsx. Alt books sort beneath every
// canon book, enforced rather than trusted to Book.order — nothing stops an alt
// book being given order 4 alongside canon book 4, and a position-based list
// would then interleave them.
const orderBooks = (books: BookIn[]) =>
  [...books].sort((a, b) =>
    (a.canon === b.canon) ? a.order - b.order : (a.canon !== false ? -1 : 1),
  )

describe('alt books sort beneath canon books', () => {
  it('puts an alt book last even when its order collides with a canon book', () => {
    const colliding: BookIn[] = [
      { id: 'alt', title: 'Undertow', order: 4, canon: false, chapters: [] },
      { id: 'b4', title: 'Four', order: 4, canon: true, chapters: [] },
      { id: 'b1', title: 'One', order: 1, canon: true, chapters: [] },
    ]
    expect(orderBooks(colliding).map(b => b.id)).toEqual(['b1', 'b4', 'alt'])
  })

  it('keeps canon order within the canon group', () => {
    expect(orderBooks(series).map(b => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'alt'])
  })

  it('numbering is unaffected by where the alt book sits', () => {
    // The bug in `idx + 1`, which this replaced: an alt book anywhere but last
    // renumbered every book after it.
    const shuffled: BookIn[] = [
      { id: 'alt', title: 'Undertow', order: 0, canon: false, chapters: [] },
      ...series.filter(b => b.canon !== false),
    ]
    const labels = computeBookLabels(shuffled, {})
    expect(labels.b1.readerLabel).toBe('Book 1')
    expect(labels.b4.readerLabel).toBe('Book 4')
    expect(labels.alt.readerLabel).toBe('Alt')
  })
})
