import { splitEmDash, expandTimes } from '@/lib/narration/tokens'

describe('splitEmDash', () => {
  it('returns the token unchanged when there is no em dash', () => {
    expect(splitEmDash('hello,')).toEqual(['hello,'])
  })
  it('splits at each em dash, keeping the dash on the left word', () => {
    expect(splitEmDash('still—waiting')).toEqual(['still—', 'waiting'])
    expect(splitEmDash('shoulder—hard—shaking')).toEqual(['shoulder—', 'hard—', 'shaking'])
  })
})

describe('expandTimes', () => {
  it('passes plain words through unchanged', () => {
    const t = [{ word: 'The', timeMs: 0 }, { word: 'end.', timeMs: 500 }]
    expect(expandTimes(t, 1000)).toEqual([0, 500])
  })

  it('interpolates em-dash sub-words across the parent span by char length', () => {
    // "ab—cd" (len 5) spans [1000, 2000): 'ab—' starts at 1000, 'cd' at
    // 1000 + 1000*(3/5) = 1600.
    const t = [{ word: 'ab—cd', timeMs: 1000 }, { word: 'next', timeMs: 2000 }]
    expect(expandTimes(t, 5000)).toEqual([1000, 1600, 2000])
  })

  it('uses the track duration as the upper bound for a trailing em-dash word', () => {
    const t = [{ word: 'go—now', timeMs: 4000 }] // len 6, 'go—' is 3 chars
    // endT = durationMs = 6000; 'now' at 4000 + 2000*(3/6) = 5000.
    expect(expandTimes(t, 6000)).toEqual([4000, 5000])
  })

  it('stays monotonic and 1:1 with the sub-token count', () => {
    const t = [
      { word: 'a—b', timeMs: 0 },
      { word: 'plain', timeMs: 300 },
      { word: 'x—y—z', timeMs: 600 },
    ]
    const out = expandTimes(t, 1200)
    expect(out).toHaveLength(2 + 1 + 3)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
  })
})
