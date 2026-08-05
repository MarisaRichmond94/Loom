'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BookEvent, BookEventAppearance } from '@/lib/chapterEvents'

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
  const [eventIds, setEventIds] = useState<Set<string>>(new Set())
  const [appearances, setAppearances] = useState<Record<string, BookEventAppearance[]>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!url) return
    const res = await fetch(url)
    if (!res.ok) return
    const data: { events: BookEvent[] } = await res.json()
    setEventIds(new Set(data.events.map(e => e.writerEventId)))
    setAppearances(Object.fromEntries(data.events.map(e => [e.writerEventId, e.appearances])))
  }, [url])

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

  return { eventIds, appearances, loading, refresh: load }
}

/** Tags within one book — the book page's Timeline tab. */
export function useBookEvents(seriesId: string, bookId: string): TaggedEvents {
  return useTaggedEvents(`/api/series/${seriesId}/books/${bookId}/events`)
}

/** Tags across a whole series — the series page's Timeline tab. */
export function useSeriesEvents(seriesId: string): TaggedEvents {
  return useTaggedEvents(`/api/series/${seriesId}/events`)
}
