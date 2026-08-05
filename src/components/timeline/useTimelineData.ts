'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { writeAiPhotoUrl } from '@/lib/writerPortrait'
import type { WriterEvent } from '@/lib/eventSearch'
import type { CharacterOption } from '@/lib/writerCharacters'

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

type WriterCharacterRow = { id?: string; name?: string; photo_url?: string | null }

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
  const [events, setEvents] = useState<WriterEvent[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [characters, setCharacters] = useState<WriterCharacterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [unreachable, setUnreachable] = useState(false)

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/writeai/events')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      // 503 means WriteAI is not running — a state the section renders
      // explicitly. Anything else is a bug on our side and should be loud.
      if (res.status === 503 || data?.unreachable) {
        setUnreachable(true)
        setEvents([])
        return
      }
      throw new Error(`events ${res.status}`)
    }
    setUnreachable(false)
    setEvents(data?.events ?? [])
    setLocations(data?.locations ?? [])
  }, [])

  const loadCharacters = useCallback(async () => {
    const res = await fetch('/api/writeai/characters')
    if (!res.ok) return // names degrade to "Unknown character"; the timeline still renders
    const data = await res.json().catch(() => null)
    setCharacters(Array.isArray(data) ? data : (data?.characters ?? []))
  }, [])

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadEvents(), loadCharacters()])
    } catch {
      setUnreachable(true)
    }
  }, [loadEvents, loadCharacters])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await Promise.all([loadEvents(), loadCharacters()])
      } catch {
        if (!cancelled) setUnreachable(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadEvents, loadCharacters])

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
