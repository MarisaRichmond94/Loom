import { computeChapterStats, countFilterWords, countReadingMinutes, estimateDialoguePercent } from '@/lib/chapterStats'

describe('countReadingMinutes', () => {
  it('rounds to the nearest minute at 200wpm', () => {
    expect(countReadingMinutes(400)).toBe(2)
    expect(countReadingMinutes(250)).toBe(1)
  })

  it('floors at 1 minute for any nonzero word count, and 0 for none', () => {
    expect(countReadingMinutes(5)).toBe(1)
    expect(countReadingMinutes(0)).toBe(0)
  })
})

describe('estimateDialoguePercent', () => {
  it('returns null for empty text', () => {
    expect(estimateDialoguePercent('', 0)).toBeNull()
  })

  it('sums words inside quote-paired spans over the total', () => {
    // "You're not actually going out there," Callum said, not quite a question.
    const text = `"You're not actually going out there," Callum said, not quite a question.`
    const total = text.split(/\s+/).filter(Boolean).length
    expect(estimateDialoguePercent(text, total)).toBe(Math.round((6 / total) * 100))
  })

  it('handles curly quotes', () => {
    const text = '“Hello there” he said.'
    expect(estimateDialoguePercent(text, 4)).toBe(Math.round((2 / 4) * 100))
  })

  it('is 0 for prose with no dialogue', () => {
    expect(estimateDialoguePercent('The tide came in slow.', 5)).toBe(0)
  })
})

describe('countFilterWords', () => {
  it('counts curated filter words case-insensitively', () => {
    expect(countFilterWords('She was really just tired.')).toBe(3) // was, really, just
  })

  it('counts -ly adverbs but excludes common false positives', () => {
    expect(countFilterWords('The family quickly ate an early, ugly meal.')).toBe(1) // quickly only
  })

  it('does not double count a word matching both rules', () => {
    // "really" is a listed filter word AND ends in -ly — should count once.
    expect(countFilterWords('really')).toBe(1)
  })
})

describe('computeChapterStats', () => {
  it('returns null dialogue percent and zeroed counts for empty text', () => {
    expect(computeChapterStats('')).toEqual({
      words: 0,
      readingMinutes: 0,
      dialoguePercent: null,
      filterWordCount: 0,
    })
  })
})
