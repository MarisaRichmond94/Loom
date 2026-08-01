import {
  buildChapterLinks,
  groupAppearances,
  parseCharacterIds,
  parseWriterCharacterId,
  type LinkRow,
  type SpreadRow,
} from '@/lib/chapterCharacters'

describe('parseWriterCharacterId', () => {
  it('accepts a WriteAI character id', () => {
    expect(parseWriterCharacterId({ writerCharacterId: 'wc-1a2b3c4d' })).toEqual({
      id: 'wc-1a2b3c4d',
    })
  })

  it('trims whitespace', () => {
    expect(parseWriterCharacterId({ writerCharacterId: '  wc-1a2b3c4d  ' })).toEqual({
      id: 'wc-1a2b3c4d',
    })
  })

  it('rejects missing, non-string or empty values', () => {
    expect(parseWriterCharacterId({})).toHaveProperty('error')
    expect(parseWriterCharacterId(null)).toHaveProperty('error')
    expect(parseWriterCharacterId({ writerCharacterId: 42 })).toHaveProperty('error')
    expect(parseWriterCharacterId({ writerCharacterId: '  ' })).toHaveProperty('error')
  })

  it('rejects an EVENT id — the two prefixes must not be interchangeable', () => {
    // Both tabs POST a single id field; crossing them would tag a character
    // row with an event and only surface much later as a vanished tag.
    expect(parseWriterCharacterId({ writerCharacterId: 'we-1a2b3c4d' })).toHaveProperty('error')
  })

  it('rejects a name — the realistic mis-post', () => {
    // Names are what WriteAI still references internally (LOOM-45); posting
    // one here is exactly the mistake this epic exists to stop.
    expect(parseWriterCharacterId({ writerCharacterId: 'Jared Gatlin' })).toHaveProperty('error')
  })

  it('does not pin the suffix format', () => {
    expect(parseWriterCharacterId({ writerCharacterId: 'wc-0123456789abcdef' })).toEqual({
      id: 'wc-0123456789abcdef',
    })
  })
})

describe('parseCharacterIds', () => {
  it('splits, trims and dedupes', () => {
    expect(parseCharacterIds('wc-aaa11111, wc-bbb22222 ,wc-aaa11111')).toEqual([
      'wc-aaa11111',
      'wc-bbb22222',
    ])
  })

  it('drops invalid ids rather than failing the request', () => {
    expect(parseCharacterIds('wc-aaa11111,garbage,we-eventid,wc-bbb22222')).toEqual([
      'wc-aaa11111',
      'wc-bbb22222',
    ])
  })

  it('treats missing or empty as none', () => {
    expect(parseCharacterIds(null)).toEqual([])
    expect(parseCharacterIds(',,,')).toEqual([])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `wc-${String(i).padStart(8, '0')}`).join(',')
    expect(parseCharacterIds(many, 10)).toHaveLength(10)
  })
})

const numbers = new Map<string, number | null>([
  ['c1', 1],
  ['c7', 7],
  ['cp', 0], // prologue
  ['cu', null], // unnumbered, not the prologue
])

describe('groupAppearances', () => {
  const row = (
    writerCharacterId: string,
    chapterId: string,
    chapterTitle: string,
    bookId = 'b1',
    bookTitle = 'Faded',
  ): SpreadRow => ({
    writerCharacterId,
    chapterId,
    chapter: { title: chapterTitle, bookId, book: { title: bookTitle } },
  })

  it('excludes the chapter being asked about', () => {
    const rows = [row('wc-a', 'c1', 'One'), row('wc-a', 'c7', 'Seven')]
    expect(groupAppearances(rows, 'c1', numbers).get('wc-a')).toEqual([
      expect.objectContaining({ chapterId: 'c7', chapterNumber: 7 }),
    ])
  })

  it('returns no entry for a character appearing only here', () => {
    expect(groupAppearances([row('wc-a', 'c1', 'One')], 'c1', numbers).get('wc-a')).toBeUndefined()
  })

  it('keeps unnumbered chapters, and sorts them last', () => {
    const rows = [
      row('wc-a', 'cu', 'Interlude'),
      row('wc-a', 'cp', 'Prologue'),
      row('wc-a', 'c1', 'One'),
    ]
    expect(groupAppearances(rows, 'cX', numbers).get('wc-a')!.map(a => a.chapterNumber)).toEqual([
      0, 1, null,
    ])
  })

  it('spans books', () => {
    const rows = [
      row('wc-a', 'c1', 'One', 'b1', 'Faded'),
      row('wc-a', 'c7', 'Seven', 'b2', 'Nobody’s Hero'),
    ]
    expect(groupAppearances(rows, 'cX', numbers).get('wc-a')!.map(a => a.bookTitle)).toEqual([
      'Faded',
      'Nobody’s Hero',
    ])
  })
})

describe('buildChapterLinks', () => {
  const row = (writerCharacterId: string, chapterId: string, chapterTitle: string): LinkRow => ({
    writerCharacterId,
    chapterId,
    chapter: {
      title: chapterTitle,
      bookId: 'b1',
      book: { title: 'Faded', seriesId: 's1', series: { title: 'Dark Horse' } },
    },
  })

  it('gives every requested id a key, even with no appearances', () => {
    const out = buildChapterLinks(['wc-a', 'wc-b'], [row('wc-a', 'c1', 'One')], numbers)
    expect(out['wc-a']).toHaveLength(1)
    expect(out['wc-b']).toEqual([])
  })

  it('denormalises everything WriteAI needs to render', () => {
    const out = buildChapterLinks(['wc-a'], [row('wc-a', 'c1', 'One')], numbers)
    expect(out['wc-a'][0]).toEqual({
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

  it('leaves unnumbered chapters unlinkable but present', () => {
    const out = buildChapterLinks(['wc-a'], [row('wc-a', 'cu', 'Interlude')], numbers)
    expect(out['wc-a'][0].chapterNumber).toBeNull()
    expect(out['wc-a'][0].readPath).toBeNull()
  })

  it('ignores rows for ids that were not requested', () => {
    const out = buildChapterLinks(['wc-a'], [row('wc-z', 'c1', 'One')], numbers)
    expect(out['wc-a']).toEqual([])
    expect(out['wc-z']).toBeUndefined()
  })
})
