import {
  aliasList,
  isCategory,
  isPovCharacter,
  matchesQuery,
  sortCharacters,
  type WriterCharacter,
} from '@/lib/characterSearch'

const ch = (over: Partial<WriterCharacter> = {}): WriterCharacter => ({
  id: 'wc-1',
  name: 'Jared Gatlin',
  category: 'main',
  role: null,
  aliases: null,
  traits: [],
  arc_notes: null,
  goals: null,
  relationships: [],
  books: [],
  photo_url: null,
  ...over,
})

describe('aliasList', () => {
  it('splits WriteAI’s comma-separated string', () => {
    // Stored as ONE string, not a list — the shape this whole module exists
    // to stop each caller re-deriving.
    expect(aliasList('Maknae, Sonja-ya, Jay, Jared Choi')).toEqual([
      'Maknae',
      'Sonja-ya',
      'Jay',
      'Jared Choi',
    ])
  })

  it('handles absent, empty and ragged values', () => {
    expect(aliasList(null)).toEqual([])
    expect(aliasList('')).toEqual([])
    expect(aliasList(' , ,Jay, ')).toEqual(['Jay'])
  })
})

describe('isCategory', () => {
  it('accepts the three real categories and nothing else', () => {
    expect(isCategory('main')).toBe(true)
    expect(isCategory('secondary')).toBe(true)
    expect(isCategory('tertiary')).toBe(true)
    expect(isCategory('Main')).toBe(false)
    expect(isCategory(null)).toBe(false)
  })
})

describe('matchesQuery', () => {
  const jared = ch({ name: 'Jared Gatlin', aliases: 'Maknae, Sonja-ya, Jay' })

  it('matches on name', () => {
    expect(matchesQuery(jared, 'gatlin')).toBe(true)
  })

  it('matches on an ALIAS — the reason search is not name-only', () => {
    // "Maknae" is what the prose calls him; searching the record name only
    // would miss exactly the case this is for.
    expect(matchesQuery(jared, 'maknae')).toBe(true)
  })

  it('narrows with multiple terms', () => {
    expect(matchesQuery(jared, 'jared jay')).toBe(true)
    expect(matchesQuery(jared, 'jared quinn')).toBe(false)
  })

  it('does NOT match goals, traits or arc notes', () => {
    // None is shown in the row, so a hit there looks arbitrary.
    const c = ch({ name: 'Emma', goals: 'escape', traits: ['stubborn'], arc_notes: 'redemption' })
    expect(matchesQuery(c, 'escape')).toBe(false)
    expect(matchesQuery(c, 'stubborn')).toBe(false)
    expect(matchesQuery(c, 'redemption')).toBe(false)
  })

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery(jared, '   ')).toBe(true)
  })
})

describe('sortCharacters', () => {
  const anna = ch({ id: 'a', name: 'Anna', category: 'main' })
  const cal = ch({ id: 'c', name: 'Cal', category: 'secondary' })
  const zeke = ch({ id: 'z', name: 'Zeke', category: 'tertiary' })
  const none = ch({ id: 'n', name: 'Mia', category: null })

  it('sorts A-Z', () => {
    expect(sortCharacters([zeke, anna, cal], 'asc').map(c => c.id)).toEqual(['a', 'c', 'z'])
  })

  it('sorts Z-A', () => {
    expect(sortCharacters([anna, zeke, cal], 'desc').map(c => c.id)).toEqual(['z', 'c', 'a'])
  })

  it('ACTUALLY reverses — the two directions must differ', () => {
    // The previous ordering led with category and fell back to name, but the
    // name tiebreak stayed ascending both ways. Since a chapter's cast tends
    // to share a category, flipping the arrow reordered nothing visible and
    // the control looked broken. This is that regression, pinned.
    const sameCategory = [
      ch({ id: '1', name: 'Emma Mendoza', category: 'main' }),
      ch({ id: '2', name: 'Jared Gatlin', category: 'main' }),
      ch({ id: '3', name: 'Noah Gatlin', category: 'main' }),
    ]
    const asc = sortCharacters(sameCategory, 'asc').map(c => c.id)
    const desc = sortCharacters(sameCategory, 'desc').map(c => c.id)
    expect(asc).toEqual(['1', '2', '3'])
    expect(desc).toEqual(['3', '2', '1'])
    expect(asc).not.toEqual(desc)
  })

  it('ignores category entirely', () => {
    // Category is what you SET on a card, not what the list is ordered by.
    expect(sortCharacters([zeke, none, anna], 'asc').map(c => c.name)).toEqual([
      'Anna', 'Mia', 'Zeke',
    ])
  })

  it('does not mutate its input', () => {
    const input = [zeke, anna]
    sortCharacters(input, 'asc')
    expect(input.map(c => c.id)).toEqual(['z', 'a'])
  })
})

describe('isPovCharacter', () => {
  const jared = ch({ name: 'Jared Gatlin' })

  it('matches the chapter POV by name', () => {
    expect(isPovCharacter(jared, 'Jared Gatlin')).toBe(true)
  })

  it('tolerates the realistic mismatches between two hand-typed fields', () => {
    expect(isPovCharacter(jared, '  jared gatlin  ')).toBe(true)
    expect(isPovCharacter(ch({ name: "Ha-eun O’Brien" }), "Ha-eun O'Brien")).toBe(true)
  })

  it('is silent on a miss rather than guessing', () => {
    // A POV naming someone who is not a character, or spelled differently,
    // simply gets no badge — the card looks exactly as it did before.
    expect(isPovCharacter(jared, 'Noah Gatlin')).toBe(false)
    expect(isPovCharacter(jared, 'Jared')).toBe(false)
    expect(isPovCharacter(jared, null)).toBe(false)
    expect(isPovCharacter(jared, '   ')).toBe(false)
  })
})
