'use client'

// Coordination between the header search bar and whatever chapter editor is
// open — the one flow where two parts of the app write to the same prose
// rows. Module-level rather than React context because SearchBar lives in the
// author layout while the editor is a page beneath it; same reasoning as the
// notification store.
//
// Two ways find-and-replace could lose writing, both closed here:
//
//   1. Stale read. The editor saves write-behind (SAVE_DEBOUNCE_MS), so the
//      database can trail what the writer sees. A replace that reads in that
//      window rewrites prose from before their last few keystrokes and writes
//      the result back, erasing them. => the search bar awaits
//      flushPendingProse() before the server reads anything.
//
//   2. Stale write-back. Once the replace lands, the open editor still holds
//      pre-replace prose. The next keystroke PATCHes that whole stale
//      document back and silently reverts the replacement. => the editor
//      subscribes here and reloads any chapter the replace touched.
//
// BroadcastChannel carries (2) to other tabs, which matter because search
// results open with target="_blank". Cross-tab is best-effort: a background
// tab's own unsaved keystrokes are not flushed before the replace reads, so
// that narrow race stays open — see the editor's subscriber for how it
// resolves in favour of the replacement.

export type ProseReplacedPayload = {
  seriesId: string
  // Chapters the replace actually wrote to. Editors on other chapters ignore
  // the message rather than reloading for nothing.
  chapterIds: string[]
}

const CHANNEL_NAME = 'loom-prose-replaced'

type FlushFn = () => Promise<void>

const flushers = new Set<FlushFn>()
const listeners = new Set<(payload: ProseReplacedPayload) => void>()

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = event => {
      const payload = event.data as ProseReplacedPayload | null
      if (!payload?.seriesId || !Array.isArray(payload.chapterIds)) return
      listeners.forEach(listener => listener(payload))
    }
  }
  return channel
}

// The open editor registers a flush of its pending write-behind saves.
// Returns the unregister function for the effect cleanup.
export function registerProseFlush(fn: FlushFn): () => void {
  flushers.add(fn)
  return () => { flushers.delete(fn) }
}

// Settle every registered editor's pending saves before a server-side read.
// Never rejects: a save that fails already raises its own error toast, and
// blocking the replace on it would strand the writer with no way forward.
export async function flushPendingProse(): Promise<void> {
  await Promise.all([...flushers].map(async fn => {
    try { await fn() } catch { /* the save path reports its own failures */ }
  }))
}

export function subscribeProseReplaced(cb: (payload: ProseReplacedPayload) => void): () => void {
  listeners.add(cb)
  // Open the channel on first subscribe so this tab can hear other tabs.
  getChannel()
  return () => { listeners.delete(cb) }
}

// Same-tab listeners are called directly — BroadcastChannel deliberately does
// not deliver a message back to the context that posted it, and the editor
// that matters most is usually in this very tab.
export function publishProseReplaced(payload: ProseReplacedPayload): void {
  if (payload.chapterIds.length === 0) return
  listeners.forEach(listener => listener(payload))
  getChannel()?.postMessage(payload)
}
