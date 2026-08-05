'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { writeAiPhotoUrl } from '@/lib/writerPortrait'
import type { WriterEvent } from '@/lib/eventSearch'
import type { CharacterOption } from '@/lib/writerCharacters'
import {
  getCachedTimelineData,
  invalidateTimelineData,
  prefetchTimelineData,
  type WriterCharacterRow,
} from './timelineDataCache'

// The WriteAI side of a timeline surface (LOOM-102).
//
// Two fetches, both on mount, neither polled:
//   * /api/writeai/events     — every event plus the location pool. A genuine
//                               side-effect-free read.
//   * /api/writeai/characters — the pool, needed to render and SEARCH casts:
//                               events store `wc-` ids (LOOM-45), so without it
//                               every card reads "Unknown character" and typing
//                               a character's name matches nothing.
//
// ⚠️ GET /api/plan/characters WRITES TO DISK on the far side — it seeds from
// canon, prunes non-characters and self-heals `books`, saving whenever any of
// that changes. Fetch on open and after mutations, NEVER poll. The dock learned
// this the hard way (see useChapterCharacters): fetching it lazily per card was
// both wrong on screen and a second concurrent caller of a write-on-read route.

export type TimelineData = {
  events: WriterEvent[]
  locations: string[]
  characterPool: CharacterOption[]
  /** Keyed by NAME — what a row has in hand when it renders a face. */
  characterPhotos: Record<string, string | null>
  loading: boolean
  /** Distinct from "no events": WriteAI being down must be SAYABLE. An empty
   *  list would read as "nothing happens in this story", which is a lie. */
  unreachable: boolean
  refresh: () => Promise<void>
}

export function useTimelineData(): TimelineData {
  // Lazy initializers, not empty-then-effect: if the page's idle prefetch
  // already landed by the time this tab mounts (the common case), this
  // renders WITH the real data on the very first paint — no empty stage, no
  // resize once the effect below catches up.
  const cachedInitial = getCachedTimelineData()
  const [events, setEvents] = useState<WriterEvent[]>(() => cachedInitial?.events ?? [])
  const [locations, setLocations] = useState<string[]>(() => cachedInitial?.locations ?? [])
  const [characters, setCharacters] = useState<WriterCharacterRow[]>(() => cachedInitial?.characters ?? [])
  const [loading, setLoading] = useState(() => !cachedInitial)
  const [unreachable, setUnreachable] = useState(() => cachedInitial?.unreachable ?? false)

  // `fresh` bypasses the cache — used by `refresh()` after a mutation, where
  // serving back whatever a prefetch happened to capture would be stale.
  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    if (opts?.fresh) invalidateTimelineData()
    const data = await prefetchTimelineData()
    setUnreachable(data.unreachable)
    setEvents(data.events)
    setLocations(data.locations)
    setCharacters(data.characters)
  }, [])

  const refresh = useCallback(() => load({ fresh: true }), [load])

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

  // An entry without an id is dropped: events reference ids, so a nameless or
  // idless row could be neither resolved nor stored. Same rule as the dock's.
  const named = useMemo(
    () => characters.filter(c => c.id && typeof c.name === 'string' && c.name.length > 0),
    [characters],
  )
  const characterPool: CharacterOption[] = useMemo(
    () =>
      named
        .map(c => ({ id: c.id!, name: c.name! }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [named],
  )
  const characterPhotos = useMemo(
    () => Object.fromEntries(named.map(c => [c.name!, writeAiPhotoUrl(c.photo_url ?? null)])),
    [named],
  )

  return { events, locations, characterPool, characterPhotos, loading, unreachable, refresh }
}
