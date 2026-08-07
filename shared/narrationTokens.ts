// Pure token helpers shared by the reader's word-wrapper (wrapWords), the
// timing expansion in NarrationBar, and the server's timing reconciliation
// (reconcileTiming). Keeping the split rule in one place is what guarantees the
// DOM sub-tokens stay 1:1 with the timing array — if the two split differently,
// the highlight drifts. No DOM or server deps.


const EM_DASH = '—'

// Split a whitespace token further at em dashes, keeping the dash attached to
// the word before it, so "shoulder—hard—shaking" becomes three highlightable
// units ("shoulder—", "hard—", "shaking") instead of one. The synthesizer emits
// the whole run as a single timing entry, so without this the em-dashed words
// all highlight together. Non-em-dash tokens return [token] unchanged.
export function splitEmDash(token: string): string[] {
  if (!token.includes(EM_DASH)) return [token]
  return token.split(/(?<=—)/).filter(p => p.length > 0)
}

type Timed = { word: string; timeMs: number }

// Split a synth timing token into the sub-tokens the DOM (wrapWords) shows as
// separate highlightable words. The synthesizer's willSpeakRange sometimes
// reports several whitespace-separated words as ONE range (e.g. "out of" as a
// single token), and joins em-dashed words too; the DOM splits both. Splitting
// the timing to match keeps timing index N aligned with DOM word N — otherwise
// every word after such a merged range drifts, and the highlight falls behind.
export function splitTimingWord(word: string): string[] {
  return word.split(/\s+/).filter(Boolean).flatMap(splitEmDash)
}

// Expand per-word synth timings so each DOM sub-word (em-dash split AND the
// whitespace inside an engine-merged range) gets its own start time,
// interpolated across the parent token's span by the sub-word's char offset.
// The upper bound is the next word's onset (or the track duration for the last
// word). Produces one entry per sub-token, matching wrapWords' span count.
export function expandTimes(timing: Timed[], durationMs: number): number[] {
  const out: number[] = []
  for (let i = 0; i < timing.length; i++) {
    const w = timing[i]
    const parts = splitTimingWord(w.word)
    if (parts.length === 0) continue // whitespace-only range — no DOM token exists for it
    if (parts.length === 1) { out.push(w.timeMs); continue }
    const startT = w.timeMs
    const endT = Math.max(startT, i + 1 < timing.length ? timing[i + 1].timeMs : durationMs)
    const totalLen = w.word.length || 1
    // Place each sub-word at its real character offset within the token, so the
    // dropped whitespace/attached em-dash are accounted for accurately.
    let searchFrom = 0
    for (const p of parts) {
      const at = w.word.indexOf(p, searchFrom)
      const off = at >= 0 ? at : searchFrom
      out.push(Math.round(startT + (endT - startT) * (off / totalLen)))
      searchFrom = off + p.length
    }
  }
  return out
}
