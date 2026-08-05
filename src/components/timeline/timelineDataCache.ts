'use client'

import type { WriterEvent } from '@/lib/eventSearch'

// Shared cache behind useTimelineData, so a page-level idle prefetch and the
// Timeline tab's own mount land on the SAME in-flight request instead of
// firing these GETs twice.
//
// ⚠️ /api/writeai/characters is not a pure read — see useTimelineData.ts's own
// warning: WriteAI seeds/prunes/self-heals `books` and SAVES on this GET.
// Prefetching moves that same request earlier; it does not add a new one.

export type WriterCharacterRow = { id?: string; name?: string; photo_url?: string | null }

export type TimelineFetchResult = {
  events: WriterEvent[]
  locations: string[]
  characters: WriterCharacterRow[]
  unreachable: boolean
}

let cached: Promise<TimelineFetchResult> | null = null
// Resolved value alongside the in-flight promise, so a component can read a
// synchronous answer for its OWN first render (a lazy useState initializer)
// instead of always mounting empty and waiting for an effect — that empty
// first paint, even when the effect resolves near-instantly off an already-
// warm cache, is what produced the tab-switch flash.
let resolved: TimelineFetchResult | null = null

async function fetchTimelineData(): Promise<TimelineFetchResult> {
  let unreachable = false
  let events: WriterEvent[] = []
  let locations: string[] = []
  let characters: WriterCharacterRow[] = []

  try {
    const res = await fetch('/api/writeai/events')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      // 503 means WriteAI is not running — a state the section renders
      // explicitly. Anything else degrades the same way: no events is safer
      // than throwing out of a prefetch nobody is watching for a rejection.
      unreachable = true
    } else {
      events = data?.events ?? []
      locations = data?.locations ?? []
    }
  } catch {
    unreachable = true
  }

  try {
    const res = await fetch('/api/writeai/characters')
    if (res.ok) {
      const data = await res.json().catch(() => null)
      characters = Array.isArray(data) ? data : (data?.characters ?? [])
    }
  } catch {
    /* names degrade to "Unknown character"; the timeline still renders */
  }

  return { events, locations, characters, unreachable }
}

/** Starts (or reuses) the WriteAI events+characters read, caching the
 *  in-flight promise so a prefetch and the Timeline tab's own mount never
 *  double-request. Global rather than keyed by series/book, matching the
 *  endpoints themselves. */
export function prefetchTimelineData() {
  if (!cached) {
    cached = fetchTimelineData().then(result => {
      resolved = result
      return result
    })
  }
  return cached
}

/** Synchronous read of whatever `prefetchTimelineData` has already resolved,
 *  or null if nothing has landed yet. */
export function getCachedTimelineData(): TimelineFetchResult | null {
  return resolved
}

/** Drops the cached entry so the next read is genuine. Call after any
 *  mutation that touches WriteAI's events or characters — `refresh()` on the
 *  hook does this. */
export function invalidateTimelineData() {
  cached = null
  resolved = null
}
