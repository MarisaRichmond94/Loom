'use client'

import type { BookEvent, BookEventAppearance } from '@/lib/chapterEvents'

// Shared cache behind useBookEvents/useSeriesEvents, so a page-level idle
// prefetch and the Timeline tab's own mount land on the SAME in-flight
// request instead of firing the GET twice.

export type TaggedEventsData = {
  eventIds: Set<string>
  appearances: Record<string, BookEventAppearance[]>
}

const cache = new Map<string, Promise<TaggedEventsData>>()
// Resolved values alongside the in-flight promises, so a component can read
// a synchronous answer for its OWN first render (a lazy useState initializer)
// instead of always mounting empty and waiting for an effect — that empty
// first paint, even when the effect resolves near-instantly off an already-
// warm cache, is what produced the tab-switch flash.
const resolved = new Map<string, TaggedEventsData>()

async function fetchTaggedEvents(url: string): Promise<TaggedEventsData> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { eventIds: new Set(), appearances: {} }
    const data: { events: BookEvent[] } = await res.json()
    return {
      eventIds: new Set(data.events.map(e => e.writerEventId)),
      appearances: Object.fromEntries(data.events.map(e => [e.writerEventId, e.appearances])),
    }
  } catch {
    return { eventIds: new Set(), appearances: {} }
  }
}

/** Starts (or reuses) the fetch for this url, caching the in-flight promise
 *  so a prefetch and the Timeline tab's own mount never double-request. */
export function prefetchTaggedEvents(url: string) {
  const existing = cache.get(url)
  if (existing) return existing
  const promise = fetchTaggedEvents(url).then(result => {
    resolved.set(url, result)
    return result
  })
  cache.set(url, promise)
  return promise
}

/** Synchronous read of whatever `prefetchTaggedEvents` has already resolved
 *  for this url, or undefined if nothing has landed yet. */
export function getCachedTaggedEvents(url: string): TaggedEventsData | undefined {
  return resolved.get(url)
}

/** Drops the cached entry so the next read is genuine. Call after any
 *  mutation that tags/untags an event — `refresh()` on the hook does this. */
export function invalidateTaggedEvents(url: string) {
  cache.delete(url)
  resolved.delete(url)
}
