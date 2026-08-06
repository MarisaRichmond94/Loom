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

// Cross-tab, because the ledger deliberately opens chapters in a NEW tab.
//
// Without this the common path is silently broken: open a finding from the
// Paths tab, fix it in the tab that opens, come back — and the ledger is still
// listing the thing you just fixed, because a module-level Set only reaches
// its own tab. That reads as the checker being wrong, which is the one thing
// this feature cannot afford.
//
// BroadcastChannel rather than a storage event: no persisted key to clean up,
// and it does not fire in the tab that posts (which already notified its own
// listeners synchronously). Guarded for SSR and for browsers without it —
// same-tab notification still works, and the focus revalidation in each
// surface covers the rest.
const CHANNEL = 'loom:reachability'

const channel: BroadcastChannel | null =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(CHANNEL)
    : null

if (channel) {
  channel.onmessage = () => {
    for (const cb of [...listeners]) {
      try { cb() } catch { /* one bad subscriber must not stop the others */ }
    }
  }
}

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
  // Then every other tab. postMessage does not echo to this one.
  try { channel?.postMessage(1) } catch { /* channel closed — same-tab already ran */ }
}

export function subscribeReachabilityChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Subscribe, and also re-check when this tab is looked at again.
 *
 * The backstop for everything the channel above cannot see: a change made
 * outside the editor (deleting a variable from the Context modal), a second
 * window, or an edit that happened while this tab was in the background and
 * whose debounce timer was throttled. Coming back to a tab is the moment its
 * answer needs to be right, and the check is a cheap pure read.
 */
export function subscribeReachabilityRevalidate(cb: Listener): () => void {
  const off = subscribeReachabilityChanged(cb)
  const onVisible = () => { if (document.visibilityState === 'visible') cb() }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', cb)
  }
  return () => {
    off()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', cb)
    }
  }
}
