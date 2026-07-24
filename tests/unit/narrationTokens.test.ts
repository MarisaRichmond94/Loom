import { splitEmDash, expandTimes, reconcileTiming } from '@/lib/narration/tokens'
import type { WordTiming } from '@/lib/narration/text'

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

  it('skips whitespace-only ranges instead of minting a phantom entry', () => {
    const t = [{ word: 'one', timeMs: 0 }, { word: ' ', timeMs: 100 }, { word: 'two', timeMs: 200 }]
    expect(expandTimes(t, 1000)).toEqual([0, 200])
  })
})

// Helper: a raw engine callback for the given substring occurrence of `text`.
function cb(text: string, word: string, timeMs: number, from = 0): WordTiming {
  const charStart = text.indexOf(word, from)
  if (charStart < 0) throw new Error(`"${word}" not in text`)
  return { charStart, charLen: word.length, timeMs, word }
}

// Each pathology below reproduces (minimized) real AVSpeechSynthesizer output
// observed on macOS with the "Tom (Enhanced)" voice — the raw callbacks are NOT
// clean per-whitespace-token announcements, which is why index-based alignment
// drifted the reader's highlight.
describe('reconcileTiming', () => {
  it('passes clean per-word callbacks through 1:1', () => {
    const text = 'The end.'
    const out = reconcileTiming(text, [cb(text, 'The', 0), cb(text, 'end.', 500)], 1000)
    expect(out.map(w => [w.word, w.timeMs])).toEqual([['The', 0], ['end.', 500]])
  })

  it('interpolates a genuine merged range ("out of") across its tokens', () => {
    const text = 'ran out of time'
    const raw = [cb(text, 'ran', 0), cb(text, 'out of', 300), cb(text, 'time', 900)]
    const out = reconcileTiming(text, raw, 1200)
    expect(out.map(w => w.word)).toEqual(['ran', 'out', 'of', 'time'])
    expect(out[1].timeMs).toBe(300)
    expect(out[2].timeMs).toBeGreaterThan(300)
    expect(out[2].timeMs).toBeLessThan(900)
  })

  it('splits em-dash runs to the sub-token granularity wrapWords renders', () => {
    const text = 'shoulder—hard—shaking him'
    const raw = [cb(text, 'shoulder—hard—shaking', 0), cb(text, 'him', 900)]
    const out = reconcileTiming(text, raw, 1200)
    expect(out.map(w => w.word)).toEqual(['shoulder—', 'hard—', 'shaking', 'him'])
    for (let i = 1; i < out.length; i++) expect(out[i].timeMs).toBeGreaterThanOrEqual(out[i - 1].timeMs)
  })

  // Pathology 1: a spurious "blob" callback spanning text that the engine then
  // re-announces word by word — the per-word re-announcements must win.
  it('lets word-by-word re-announcements refine a blob estimate', () => {
    const text = 'He waved (if you can call it that) at me'
    const raw = [
      cb(text, 'He', 0),
      cb(text, 'waved', 200),
      cb(text, '(if you can call it that) at', 400), // blob
      cb(text, '(if', 400),
      cb(text, 'you', 550),
      cb(text, 'can', 700),
      cb(text, 'call', 850),
      cb(text, 'it', 1000),
      cb(text, 'that)', 1150),
      cb(text, 'at', 1300, text.indexOf('that)') + 5), // the standalone "at", not the one inside "that)"
      cb(text, 'me', 1450),
    ]
    const out = reconcileTiming(text, raw, 1600)
    expect(out.map(w => w.word)).toEqual(['He', 'waved', '(if', 'you', 'can', 'call', 'it', 'that)', 'at', 'me'])
    // Real per-word onsets, not the blob's interpolation:
    expect(out.map(w => w.timeMs)).toEqual([0, 200, 400, 550, 700, 850, 1000, 1150, 1300, 1450])
  })

  // Pathology 2: a backward duplicate re-announcing already-spoken words
  // ("I am." emitted again after its words) must not shift later indices.
  it('ignores backward duplicate ranges', () => {
    const text = 'I am. Maybe you misheard'
    const raw = [
      cb(text, 'I', 0),
      cb(text, 'am.', 150),
      cb(text, 'I am.', 300), // duplicate of what was just spoken
      cb(text, 'Maybe', 450),
      cb(text, 'you', 600),
      cb(text, 'misheard', 750),
    ]
    const out = reconcileTiming(text, raw, 900)
    expect(out.map(w => [w.word, w.timeMs])).toEqual([
      ['I', 0], ['am.', 150], ['Maybe', 450], ['you', 600], ['misheard', 750],
    ])
  })

  // Pathology 3: one text token split into two callbacks ("dish" + ',”') —
  // the token keeps its onset; the punctuation callback adds nothing.
  it('collapses split-punctuation callbacks onto their token', () => {
    const text = 'signature dish,” she said'
    const raw = [
      cb(text, 'signature', 0),
      cb(text, 'dish', 200),
      cb(text, ',”', 350),
      cb(text, 'she', 400),
      cb(text, 'said', 550),
    ]
    const out = reconcileTiming(text, raw, 700)
    expect(out.map(w => [w.word, w.timeMs])).toEqual([
      ['signature', 0], ['dish,”', 200], ['she', 400], ['said', 550],
    ])
  })

  // Pathology 4: tokens the engine never announces (a "* * *" scene break gets
  // no callbacks at all) must still get times so later indices stay aligned.
  it('interpolates times for silent tokens like scene breaks', () => {
    const text = 'The end.\n\n* * *\n\nA new day'
    const raw = [
      cb(text, 'The', 0),
      cb(text, 'end.', 200),
      cb(text, 'A', 1000),
      cb(text, 'new', 1200),
      cb(text, 'day', 1400),
    ]
    const out = reconcileTiming(text, raw, 1600)
    expect(out.map(w => w.word)).toEqual(['The', 'end.', '*', '*', '*', 'A', 'new', 'day'])
    const times = out.map(w => w.timeMs)
    expect(times[5]).toBe(1000) // 'A' keeps its real onset
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
    // The silent tokens sweep between their neighbors rather than sticking.
    expect(times[2]).toBeGreaterThan(200)
    expect(times[4]).toBeLessThan(1000)
  })

  // The torture-test blob: a backward mega-range covering already-announced
  // words plus one never-announced token ("$4.50") — observed verbatim from
  // AVSpeechSynthesizer. Earlier words keep their real times; the unannounced
  // token gets its time from the blob; output count matches the DOM exactly.
  it('survives a backward blob while timing its only new token', () => {
    const text = 'It was 3 a.m. when it cost $4.50 (roughly).'
    const raw = [
      cb(text, 'It', 0),
      cb(text, 'was', 100),
      cb(text, '3', 200),
      cb(text, 'a.m.', 300),
      cb(text, 'when', 400),
      cb(text, 'it', 500, 15),
      cb(text, 'cost', 600),
      cb(text, 'a.m. when it cost $4.50', 700), // backward blob ending at the new token
      cb(text, '(roughly).', 1000),
    ]
    const out = reconcileTiming(text, raw, 1200)
    expect(out.map(w => w.word)).toEqual(['It', 'was', '3', 'a.m.', 'when', 'it', 'cost', '$4.50', '(roughly).'])
    // Already-spoken words untouched by the blob:
    expect(out.map(w => w.timeMs).slice(0, 7)).toEqual([0, 100, 200, 300, 400, 500, 600])
    // "$4.50" timed from the blob (between "cost" and "(roughly).")
    expect(out[7].timeMs).toBeGreaterThanOrEqual(700)
    expect(out[7].timeMs).toBeLessThanOrEqual(1000)
    expect(out[8].timeMs).toBe(1000)
  })

  it('clamps non-monotonic assignments so binary search stays valid', () => {
    const text = 'a b c'
    const raw = [cb(text, 'a', 500), cb(text, 'b', 300), cb(text, 'c', 400)]
    const out = reconcileTiming(text, raw, 600)
    expect(out.map(w => w.timeMs)).toEqual([500, 500, 500])
  })

  it('returns empty for empty text', () => {
    expect(reconcileTiming('', [], 0)).toEqual([])
  })
})
