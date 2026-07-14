// Pure token helpers shared by the reader's word-wrapper (wrapWords) and the
// timing expansion in NarrationBar. Keeping the split rule in one place is what
// guarantees the DOM sub-tokens stay 1:1 with the expanded timing array — if the
// two split differently, the highlight drifts. No DOM or server deps.

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

// Expand per-word synth timings so each em-dash sub-word gets its own start
// time, interpolated across the parent token's span by character length. The
// upper bound is the next word's onset (or the track duration for the last
// word). Produces one entry per sub-token, matching wrapWords' span count.
export function expandTimes(timing: Timed[], durationMs: number): number[] {
  const out: number[] = []
  for (let i = 0; i < timing.length; i++) {
    const w = timing[i]
    const parts = splitEmDash(w.word)
    if (parts.length === 1) { out.push(w.timeMs); continue }
    const startT = w.timeMs
    const endT = Math.max(startT, i + 1 < timing.length ? timing[i + 1].timeMs : durationMs)
    const totalLen = w.word.length || 1
    let acc = 0
    for (const p of parts) {
      out.push(Math.round(startT + (endT - startT) * (acc / totalLen)))
      acc += p.length
    }
  }
  return out
}
