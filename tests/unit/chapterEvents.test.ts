import {
  buildChapterLinks,
  groupAppearances,
  parseEventIds,
  parseWriterEventId,
  type LinkRow,
  type SpreadRow,
} from '@/lib/chapterEvents'

describe('parseWriterEventId', () => {
  it('accepts a WriteAI event id', () => {
    expect(parseWriterEventId({ writerEventId: 'we-1a2b3c4d' })).toEqual({ id: 'we-1a2b3c4d' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseWriterEventId({ writerEventId: '  we-1a2b3c4d  ' })).toEqual({ id: 'we-1a2b3c4d' })
  })

  it('rejects a missing, non-string, or empty field', () => {
    expect(parseWriterEventId({})).toHaveProperty('error')
    expect(parseWriterEventId(null)).toHaveProperty('error')
    expect(parseWriterEventId({ writerEventId: 42 })).toHaveProperty('error')
    expect(parseWriterEventId({ writerEventId: '   ' })).toHaveProperty('error')
  })

  it('rejects an id that is not an event id — the realistic mis-post', () => {
    // A chapter cuid or an event *title* landing in this field is the bug the
    // prefix check exists to catch.
    expect(parseWriterEventId({ writerEventId: 'clx123abc456' })).toHaveProperty('error')
    expect(parseWriterEventId({ writerEventId: 'Emma has a miscarriage' })).toHaveProperty('error')
  })

  it('caps length', () => {
    expect(parseWriterEventId({ writerEventId: 'we-' + 'a'.repeat(200) })).toHaveProperty('error')
  })

  it('does NOT pin the suffix format — WriteAI may change how it mints ids', () => {
    expect(parseWriterEventId({ writerEventId: 'we-0123456789abcdef' })).toEqual({
      id: 'we-0123456789abcdef',
    })
  })
})

describe('groupAppearances', () => {
  const row = (
    writerEventId: string,
    chapterId: string,
    chapterTitle: string,
    bookId: string,
    bookTitle: string,
  ): SpreadRow => ({
    writerEventId,
    chapterId,
    chapter: { title: chapterTitle, bookId, book: { title: bookTitle } },
  })

  const numbers = new Map<string, number | null>([
    ['c1', 1],
    ['c3', 3],
    ['c7', 7],
    ['cp', 0], // prologue
    ['cu', null], // unnumbered, not the prologue
  ])

  it('excludes the chapter being asked about', () => {
    const rows = [row('we-a', 'c1', 'One', 'b1', 'Faded'), row('we-a', 'c3', 'Three', 'b1', 'Faded')]
    expect(groupAppearances(rows, 'c1', numbers).get('we-a')).toEqual([
      expect.objectContaining({ chapterId: 'c3', chapterNumber: 3 }),
    ])
  })

  it('returns no entry for an event tagged only in this chapter', () => {
    const rows = [row('we-a', 'c1', 'One', 'b1', 'Faded')]
    expect(groupAppearances(rows, 'c1', numbers).get('we-a')).toBeUndefined()
  })

  it('spans books', () => {
    const rows = [
      row('we-a', 'c1', 'One', 'b1', 'Faded'),
      row('we-a', 'c3', 'Three', 'b2', 'The Secrets We Keep'),
    ]
    const got = groupAppearances(rows, 'cX', numbers).get('we-a')!
    expect(got.map(a => a.bookTitle)).toEqual(['Faded', 'The Secrets We Keep'])
  })

  it('keeps unnumbered chapters rather than dropping them', () => {
    // A tag on an unnumbered chapter is real and should stay visible; it just
    // has no canon address to link to.
    const rows = [row('we-a', 'cu', 'Interlude', 'b1', 'Faded')]
    expect(groupAppearances(rows, 'cX', numbers).get('we-a')).toEqual([
      expect.objectContaining({ chapterId: 'cu', chapterNumber: null }),
    ])
  })

  it('reports a chapter missing from the number map as null, not absent', () => {
    const rows = [row('we-a', 'c999', 'Ghost', 'b1', 'Faded')]
    expect(groupAppearances(rows, 'cX', numbers).get('we-a')).toEqual([
      expect.objectContaining({ chapterId: 'c999', chapterNumber: null }),
    ])
  })

  it('sorts by book, then chapter number, with the prologue first', () => {
    const rows = [
      row('we-a', 'c7', 'Seven', 'b1', 'Faded'),
      row('we-a', 'c1', 'One', 'b1', 'Faded'),
      row('we-a', 'cp', 'Prologue', 'b1', 'Faded'),
    ]
    expect(groupAppearances(rows, 'cX', numbers).get('we-a')!.map(a => a.chapterNumber)).toEqual([
      0, 1, 7,
    ])
  })

  it('sorts unnumbered chapters last instead of treating them as 0', () => {
    const rows = [
      row('we-a', 'cu', 'Interlude', 'b1', 'Faded'),
      row('we-a', 'cp', 'Prologue', 'b1', 'Faded'),
      row('we-a', 'c1', 'One', 'b1', 'Faded'),
    ]
    expect(groupAppearances(rows, 'cX', numbers).get('we-a')!.map(a => a.chapterNumber)).toEqual([
      0, 1, null,
    ])
  })

  it('keeps events separate', () => {
    const rows = [row('we-a', 'c1', 'One', 'b1', 'Faded'), row('we-b', 'c3', 'Three', 'b1', 'Faded')]
    const got = groupAppearances(rows, 'cX', numbers)
    expect(got.get('we-a')!.map(a => a.chapterId)).toEqual(['c1'])
    expect(got.get('we-b')!.map(a => a.chapterId)).toEqual(['c3'])
  })
})

describe('parseEventIds', () => {
  it('splits, trims, and dedupes', () => {
    expect(parseEventIds('we-aaa11111, we-bbb22222 ,we-aaa11111')).toEqual([
      'we-aaa11111',
      'we-bbb22222',
    ])
  })

  it('treats missing or empty as no ids', () => {
    expect(parseEventIds(null)).toEqual([])
    expect(parseEventIds('')).toEqual([])
    expect(parseEventIds(',,,')).toEqual([])
  })

  it('DROPS invalid ids rather than failing the whole request', () => {
    // One stale id on a timeline must not blank every other event's links.
    expect(parseEventIds('we-aaa11111,garbage,we-bbb22222')).toEqual([
      'we-aaa11111',
      'we-bbb22222',
    ])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `we-${String(i).padStart(8, '0')}`).join(',')
    expect(parseEventIds(many, 10)).toHaveLength(10)
  })
})

describe('buildChapterLinks', () => {
  const row = (writerEventId: string, chapterId: string, chapterNumberTitle: string): LinkRow => ({
    writerEventId,
    chapterId,
    chapter: {
      title: chapterNumberTitle,
      bookId: 'b1',
      book: { title: 'Faded', seriesId: 's1', series: { title: 'Dark Horse' } },
    },
  })
  const numbers = new Map<string, number | null>([['c1', 1], ['c7', 7], ['cu', null]])

  it('gives every requested id a key, even with no tags', () => {
    const out = buildChapterLinks(['we-a', 'we-b'], [row('we-a', 'c1', 'One')], numbers)
    expect(out['we-a']).toHaveLength(1)
    // Empty array is a real answer ("tagged nowhere"), not a missing key.
    expect(out['we-b']).toEqual([])
  })

  it('denormalises series, book and chapter so WriteAI resolves nothing', () => {
    const out = buildChapterLinks(['we-a'], [row('we-a', 'c1', 'One')], numbers)
    expect(out['we-a'][0]).toEqual({
      seriesId: 's1',
      seriesTitle: 'Dark Horse',
      bookId: 'b1',
      bookTitle: 'Faded',
      chapterId: 'c1',
      chapterTitle: 'One',
      chapterNumber: 1,
      readPath: '/read/by-id/s1/b1/1',
    })
  })

  it('keeps unnumbered chapters but leaves them unlinkable', () => {
    const out = buildChapterLinks(['we-a'], [row('we-a', 'cu', 'Interlude')], numbers)
    expect(out['we-a'][0].chapterNumber).toBeNull()
    expect(out['we-a'][0].readPath).toBeNull()
  })

  it('ignores rows for ids that were not requested', () => {
    const out = buildChapterLinks(['we-a'], [row('we-z', 'c1', 'One')], numbers)
    expect(out['we-a']).toEqual([])
    expect(out['we-z']).toBeUndefined()
  })

  it('sorts unnumbered chapters last', () => {
    const out = buildChapterLinks(
      ['we-a'],
      [row('we-a', 'cu', 'Interlude'), row('we-a', 'c7', 'Seven'), row('we-a', 'c1', 'One')],
      numbers,
    )
    expect(out['we-a'].map(l => l.chapterNumber)).toEqual([1, 7, null])
  })
})
