// "Something that changes reachability was just saved" (LOOM-122).
//
// The Paths tab and the chapter banner both read a computed answer. Without a
// signal they would hold whatever was true when they mounted — so a writer who
// fixed a dead branch would still be looking at the warning for it, and would
// reasonably conclude the check was wrong. A stale correctness tool is worse
// than no correctness tool.
//
// There was no existing signal to reuse. Block, override and choice edits
// update BlockEditor's own state and PATCH from there; they deliberately do
// NOT call onBlocksChange, because a full refetch on every keystroke is
// exactly what that local-state design avoids. So this is a separate, tiny
// channel: same subscribe/notify shape as proseSync, carrying nothing but
// "re-ask the server".
//
// Deliberately not a payload. Reachability is a whole-series property — an
// edit in book 2 can revive or kill a branch in book 4 — so there is no
// meaningful "what changed" smaller than "ask again", and pretending
// otherwise would invite a partial update that is subtly wrong.

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Fields whose value changes what a reader can reach. Prose content is
 * deliberately absent: `content`, `baseContent` and `prompt` are the
 * high-frequency saves, and none of them affects reachability at all.
 */
const REACHABILITY_KEYS = new Set([
  'condition',
  'setsVariables',
  'isBadEnding',
  'endsChapter',
  'order',
  'numbered',
])

/** True when a save payload touches anything the analysis depends on. */
export function affectsReachability(data: Record<string, unknown>): boolean {
  return Object.keys(data).some(k => REACHABILITY_KEYS.has(k))
}

/** Announce that the structure changed. Safe to call often — subscribers debounce. */
export function notifyReachabilityChanged(): void {
  for (const cb of [...listeners]) {
    try { cb() } catch { /* one bad subscriber must not stop the others */ }
  }
}

export function subscribeReachabilityChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
