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

describe('matchRanges — smart-quote folding', () => {
  it('matches a straight apostrophe against a stored curly one', () => {
    // Prose is educated to U+2019; the search box gives U+0027.
    expect(matchRanges('you shouldn’t go', "shouldn't").length).toBe(1)
  })

  it('matches a curly apostrophe query against straight prose', () => {
    expect(matchRanges("you shouldn't go", 'shouldn’t').length).toBe(1)
  })

  it('folds curly double quotes both ways', () => {
    expect(matchRanges('he said “hi”', '"hi"').length).toBe(1)
    expect(matchRanges('he said "hi"', '“hi”').length).toBe(1)
  })

  it('keeps match indices aligned with the original text (length-preserving)', () => {
    const hay = 'a ‘b’ shouldn’t'
    const r = matchRanges(hay, "shouldn't")
    expect(r.length).toBe(1)
    // index must point at the real "shouldn't" in the ORIGINAL string
    expect(hay.slice(r[0].index, r[0].index + r[0].length)).toBe('shouldn’t')
  })

  it('still honours case and whole-word with folded quotes', () => {
    expect(
      matchRanges('Don’t say don’t', "don't", { wholeWord: true }).length,
    ).toBe(2)
    expect(
      matchRanges('Don’t say don’t', "don't", { caseSensitive: true }).length,
    ).toBe(1)
  })
})

describe('matchRanges — em-dash folding', () => {
  // The editor's EmDash input rule rewrites a typed `--` as `—`, so the prose
  // never contains what the writer types into the search box.
  it('finds an em dash when the query is a double hyphen', () => {
    const r = matchRanges('She stopped—then ran.', '--')
    expect(r).toEqual([{ index: 11, length: 1 }])
  })

  it('reports the matched span, not the query length', () => {
    const hay = 'a—b'
    const [hit] = matchRanges(hay, '--')
    expect(hay.slice(hit.index, hit.index + hit.length)).toBe('—')
  })

  it('matches a double hyphen inside a longer phrase', () => {
    expect(matchRanges('wait—no, listen', 'wait--no').length).toBe(1)
  })

  it('still finds a literal double hyphen in imported prose', () => {
    const r = matchRanges('raw -- text', '--')
    expect(r).toEqual([{ index: 4, length: 2 }])
  })

  it('finds both spellings in one pass, without overlapping ranges', () => {
    const r = matchRanges('a--b and c—d', '--')
    expect(r.map(m => m.index)).toEqual([1, 10])
    expect(r.map(m => m.length)).toEqual([2, 1])
  })

  it('does not double-count a hyphen run that satisfies both spellings', () => {
    expect(matchRanges('a---b', '--').length).toBe(1)
  })

  it('a literal em-dash query still matches em-dash prose', () => {
    expect(matchRanges('stop—go', '—').length).toBe(1)
  })

  it('honours whole-word against the em dash it actually matched', () => {
    // The em dash is not a word char, so the flanking letters block the match.
    expect(matchRanges('stop—go', '--', { wholeWord: true }).length).toBe(0)
    expect(matchRanges('stop — go', '--', { wholeWord: true }).length).toBe(1)
  })
})
