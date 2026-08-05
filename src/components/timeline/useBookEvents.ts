'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BookEvent, BookEventAppearance } from '@/lib/chapterEvents'

// Loom's side of the book page's Timeline tab (LOOM-103).
//
// Which events are tagged to chapters in THIS book, and where. Deliberately
// separate from useTimelineData: that one is WriteAI's list, this one is Loom's
// join, and merging them on the server would make a local query fail whenever
// WriteAI is down — on a page whose other tabs render fine without it.
//
// The join happens in the component. An id Loom has tagged that WriteAI no
// longer knows about simply drops out of the intersection: unknown identity,
// hidden rather than errored, never auto-deleted. That is INTEGRATION.md's
// degradation contract, and it costs no code.

export function useBookEvents(seriesId: string, bookId: string) {
  const [eventIds, setEventIds] = useState<Set<string>>(new Set())
  const [appearances, setAppearances] = useState<Record<string, BookEventAppearance[]>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/events`)
    if (!res.ok) return
    const data: { events: BookEvent[] } = await res.json()
    setEventIds(new Set(data.events.map(e => e.writerEventId)))
    setAppearances(Object.fromEntries(data.events.map(e => [e.writerEventId, e.appearances])))
  }, [seriesId, bookId])

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
