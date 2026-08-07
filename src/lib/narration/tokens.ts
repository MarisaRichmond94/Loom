// Server-side timing reconciliation, plus a re-export of the pure token split
// rule it shares with the word-wrapper.
//
// The split rule itself moved to shared/narrationTokens.ts when the reader app
// (LOOM-131) needed it: the guarantee this whole file rests on is that the DOM
// sub-tokens stay 1:1 with the timing array, and that only holds while ONE
// definition of "a token" exists. Two apps splitting em dashes slightly
// differently is a highlight that drifts in one of them and nowhere else.

import { splitEmDash, splitTimingWord, expandTimes } from '@shared/narrationTokens'

import type { WordTiming } from './text'

export { splitEmDash, splitTimingWord, expandTimes }

// ---------------------------------------------------------------------------
// Timing reconciliation
//
// The naive assumption — that AVSpeechSynthesizer's willSpeakRange callbacks
// arrive one per whitespace token, in order — does not hold. Measured against
// real synthesis output (see tests), the engine exhibits four pathologies:
//
//   1. "Blob" ranges: a spurious callback spanning a whole phrase/paragraph
//      (sometimes text it already announced word-by-word, sometimes text it is
//      about to re-announce word-by-word).
//   2. Backward duplicates: short ranges re-announcing words already spoken
//      ("I am." emitted again after "am").
//   3. Split punctuation: one text token announced as two callbacks
//      ("dish" + ",”").
//   4. Silent tokens: no callback at all for unspoken tokens ("* * *" scene
//      breaks).
//
// Index-based alignment (timing[N] ↔ DOM word N) therefore drifts — by
// thousands of entries in long chapters. reconcileTiming realigns by CHARACTER
// OFFSET instead: it tokenizes `text` with the exact rule wrapWords uses
// (/\S+/ further split at em dashes) and assigns each token a start time from
// whichever callbacks overlap its character range. The result has exactly one
// entry per DOM sub-token, so the client's index mapping is correct by
// construction.
export function reconcileTiming(text: string, raw: WordTiming[], durationMs: number): WordTiming[] {
  // The canonical token stream: /\S+/ tokens sub-split at em dashes, with the
  // char range each sub-token occupies in `text`.
  const tokens: { word: string; start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let off = 0
    for (const part of splitEmDash(m[0])) {
      tokens.push({ word: part, start: m.index + off, end: m.index + off + part.length })
      off += part.length
    }
  }
  if (tokens.length === 0) return []

  const times: (number | null)[] = new Array(tokens.length).fill(null)
  // How a token got its time: a range covering just that token ('single', the
  // engine's real per-word onset) beats interpolation across a multi-token
  // range ('multi'), so a word-by-word re-announcement after a blob refines
  // the blob's estimates — but nothing ever overwrites a 'single'.
  const source: ('single' | 'multi' | null)[] = new Array(tokens.length).fill(null)

  // First token whose range ends after `pos` (tokens are sorted by start).
  const firstTokenAfter = (pos: number): number => {
    let lo = 0, hi = tokens.length - 1, ans = tokens.length
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (tokens[mid].end > pos) { ans = mid; hi = mid - 1 } else { lo = mid + 1 }
    }
    return ans
  }

  for (let i = 0; i < raw.length; i++) {
    const cb = raw[i]
    if (cb.charLen <= 0) continue
    const s = cb.charStart
    const e = cb.charStart + cb.charLen
    const first = firstTokenAfter(s)
    let last = first - 1
    while (last + 1 < tokens.length && tokens[last + 1].start < e) last++
    if (last < first) continue // range covers only whitespace — nothing to time

    if (last === first) {
      // Exact (or partial — split punctuation) coverage of one token. Keep the
      // first single assignment: it's the word's onset; a later re-announcement
      // or trailing-punctuation callback for the same token is a duplicate.
      if (source[first] !== 'single') { times[first] = cb.timeMs; source[first] = 'single' }
      continue
    }
    // Multi-token range: a genuine merged announcement ("out of"), an em-dash
    // run, or a spurious blob. Give each still-unassigned token an estimate
    // interpolated across the range by char offset (bounded by the next
    // callback's onset). Tokens already timed keep their times — that's what
    // makes an overlapping blob harmless.
    const endT = Math.max(cb.timeMs, i + 1 < raw.length ? raw[i + 1].timeMs : durationMs)
    for (let t = first; t <= last; t++) {
      if (source[t] !== null) continue
      const frac = (tokens[t].start - s) / (e - s)
      times[t] = Math.round(cb.timeMs + (endT - cb.timeMs) * Math.max(0, Math.min(1, frac)))
      source[t] = 'multi'
    }
  }

  // Fill tokens no callback covered (silent scene breaks, engine skips):
  // interpolate evenly between the nearest timed neighbors so the highlight
  // sweeps through rather than sticking.
  let prevIdx = -1
  for (let t = 0; t < tokens.length; t++) {
    if (times[t] === null) continue
    if (prevIdx < t - 1) {
      const lo = prevIdx >= 0 ? times[prevIdx]! : 0
      const hi = times[t]!
      for (let g = prevIdx + 1; g < t; g++) {
        times[g] = Math.round(lo + (hi - lo) * ((g - prevIdx) / (t - prevIdx)))
      }
    }
    prevIdx = t
  }
  for (let t = prevIdx + 1; t < tokens.length; t++) times[t] = prevIdx >= 0 ? times[prevIdx]! : 0

  // The engine's callbacks aren't guaranteed monotonic; the highlight's binary
  // search requires it.
  const out: WordTiming[] = []
  let floor = 0
  for (let t = 0; t < tokens.length; t++) {
    floor = Math.max(floor, times[t]!)
    out.push({ word: tokens[t].word, charStart: tokens[t].start, charLen: tokens[t].end - tokens[t].start, timeMs: floor })
  }
  return out
}
