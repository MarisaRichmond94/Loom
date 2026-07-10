import { matchRanges } from '@/lib/searchMatch'

describe('matchRanges — match case / whole word', () => {
  it('is case-insensitive by default', () => {
    expect(matchRanges('The Cat sat, a CAT.', 'cat').length).toBe(2)
  })

  it('respects caseSensitive', () => {
    const r = matchRanges('The Cat sat, a cat.', 'cat', { caseSensitive: true })
    expect(r.length).toBe(1)
    expect(r[0].index).toBe(15) // the lowercase "cat"
  })

  it('matches substrings by default (wholeWord off)', () => {
    expect(matchRanges('category cat scatter', 'cat').length).toBe(3)
  })

  it('respects wholeWord — only standalone occurrences', () => {
    const r = matchRanges('category cat scatter cat!', 'cat', { wholeWord: true })
    expect(r.length).toBe(2)
    // "cat" at index 9 and "cat" at index 21, not inside category/scatter
    expect(r.map(m => m.index)).toEqual([9, 21])
  })

  it('whole-word treats punctuation and string edges as boundaries', () => {
    expect(matchRanges('cat', 'cat', { wholeWord: true }).length).toBe(1)
    expect(matchRanges('(cat)', 'cat', { wholeWord: true }).length).toBe(1)
    expect(matchRanges("cat's", 'cat', { wholeWord: true }).length).toBe(1) // apostrophe is a boundary
  })

  it('combines caseSensitive + wholeWord', () => {
    const r = matchRanges('Cat cat CAT catalog', 'cat', { caseSensitive: true, wholeWord: true })
    expect(r.length).toBe(1)
    expect(r[0].index).toBe(4)
  })

  it('trims the query and returns empty for blank', () => {
    expect(matchRanges('anything', '   ').length).toBe(0)
    expect(matchRanges('a cat here', '  cat ').length).toBe(1)
  })

  it('handles accented word boundaries (Unicode word class)', () => {
    // "café" — the accented letter is a word char, so "caf" is NOT a whole word.
    expect(matchRanges('café', 'caf', { wholeWord: true }).length).toBe(0)
    expect(matchRanges('café au lait', 'café', { wholeWord: true }).length).toBe(1)
  })
})
