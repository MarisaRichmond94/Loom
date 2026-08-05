'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BookEventAppearance } from '@/lib/chapterEvents'
import { getCachedTaggedEvents, invalidateTaggedEvents, prefetchTaggedEvents } from './taggedEventsCache'

// Loom's side of a timeline surface (LOOM-103, extended in LOOM-107).
//
// Which events are tagged where. Deliberately separate from useTimelineData:
// that one is WriteAI's event list, this one is Loom's join, and merging them
// on the server would make a local query fail whenever WriteAI is down — on a
// page whose other tabs render fine without it.
//
// The join happens in the component. An id Loom has tagged that WriteAI no
// longer knows about simply drops out: unknown identity, hidden rather than
// errored, never auto-deleted. That is INTEGRATION.md's degradation contract,
// and it costs no code.
//
// Two scopes, one hook, because the two tabs want the SAME data for different
// reasons: the book tab FILTERS by it, the series tab only badges with it.

export type TaggedEvents = {
  /** Every event tagged in scope. The book tab filters on this; the series tab
   *  ignores it, since it shows everything. */
  eventIds: Set<string>
  appearances: Record<string, BookEventAppearance[]>
  loading: boolean
  refresh: () => Promise<void>
}

function useTaggedEvents(url: string | null): TaggedEvents {
  // Lazy initializers, not empty-then-effect: if the page's idle prefetch
  // already landed by the time this tab mounts (the common case), this
  // renders WITH the real join on the very first paint — no empty stage, no
  // resize once the effect below catches up.
  const cachedInitial = url ? getCachedTaggedEvents(url) : undefined
  const [eventIds, setEventIds] = useState<Set<string>>(() => cachedInitial?.eventIds ?? new Set())
  const [appearances, setAppearances] = useState<Record<string, BookEventAppearance[]>>(
    () => cachedInitial?.appearances ?? {},
  )
  const [loading, setLoading] = useState(() => !cachedInitial)

  // `fresh` bypasses the cache — used by `refresh()` after a tag/untag, where
  // serving back whatever a prefetch happened to capture would be stale.
  const load = useCallback(
    async (opts?: { fresh?: boolean }) => {
      if (!url) return
      if (opts?.fresh) invalidateTaggedEvents(url)
      const data = await prefetchTaggedEvents(url)
      setEventIds(data.eventIds)
      setAppearances(data.appearances)
    },
    [url],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const refresh = useCallback(() => load({ fresh: true }), [load])

  return { eventIds, appearances, loading, refresh }
}

/** Tags within one book — the book page's Timeline tab. */
export function useBookEvents(seriesId: string, bookId: string): TaggedEvents {
  return useTaggedEvents(`/api/series/${seriesId}/books/${bookId}/events`)
}

/** Tags across a whole series — the series page's Timeline tab. */
export function useSeriesEvents(seriesId: string): TaggedEvents {
  return useTaggedEvents(`/api/series/${seriesId}/events`)
}

/** Warms the series-wide tagged-events read ahead of the Timeline tab being
 *  opened — see taggedEventsCache.ts. */
export function prefetchSeriesEvents(seriesId: string) {
  return prefetchTaggedEvents(`/api/series/${seriesId}/events`)
}
