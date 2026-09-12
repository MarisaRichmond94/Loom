import { replaceInString } from '@/lib/replaceInTipTap'

describe('replaceInString — match case / whole word', () => {
  it('case-insensitive substring by default', () => {
    const r = replaceInString('Cat cat CAT catalog', 'cat', 'dog')
    expect(r.count).toBe(4)
    expect(r.value).toBe('dog dog dog dogalog')
  })

  it('respects caseSensitive', () => {
    const r = replaceInString('Cat cat CAT', 'cat', 'dog', { caseSensitive: true })
    expect(r.count).toBe(1)
    expect(r.value).toBe('Cat dog CAT')
  })

  it('respects wholeWord', () => {
    const r = replaceInString('cat catalog scatter cat', 'cat', 'dog', { wholeWord: true })
    expect(r.count).toBe(2)
    expect(r.value).toBe('dog catalog scatter dog')
  })

  it('combines caseSensitive + wholeWord', () => {
    const r = replaceInString('Cat cat CAT catalog', 'cat', 'dog', { caseSensitive: true, wholeWord: true })
    expect(r.count).toBe(1)
    expect(r.value).toBe('Cat dog CAT catalog')
  })

  it('whole-word count matches the search-count semantics (apostrophe is a boundary)', () => {
    const r = replaceInString("the cat's toy", 'cat', 'dog', { wholeWord: true })
    expect(r.count).toBe(1)
    expect(r.value).toBe("the dog's toy")
  })
})

describe('replaceInString — em dash', () => {
  // Must agree with matchRanges, or the series search reports hits that
  // Replace then silently declines to touch.
  it('a `--` find matches the em dash the editor stored', () => {
    const r = replaceInString('She stopped—then ran.', '--', ', ')
    expect(r.count).toBe(1)
    expect(r.value).toBe('She stopped, then ran.')
  })

  it('still matches a literal double hyphen', () => {
    const r = replaceInString('raw -- text', '--', '—')
    expect(r.count).toBe(1)
    expect(r.value).toBe('raw — text')
  })

  it('matches both spellings in one pass', () => {
    const r = replaceInString('a--b c—d', '--', '+')
    expect(r.count).toBe(2)
    expect(r.value).toBe('a+b c+d')
  })
})
