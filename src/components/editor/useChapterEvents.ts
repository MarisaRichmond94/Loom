'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from '@/lib/notifications'
import type { WriterEvent } from '@/lib/eventSearch'
import type { CharacterOption } from '@/lib/writerCharacters'

// The Events tab's data (LOOM-32 / LOOM-36).
//
// Two sources, deliberately not merged on the server:
//   * Loom  — which event ids are tagged to this chapter, and the other
//             chapters each is tagged in ("also in Ch. 7").
//   * WriteAI — what those events actually are.
//
// Loom stores ids and nothing else, so the join happens here. The upside is
// that an id WriteAI no longer knows about simply drops out of the tagged view:
// unknown identity, hidden rather than errored, and never auto-deleted. That is
// the degradation contract from INTEGRATION.md, and it costs no code.

export type EventAppearance = {
  chapterId: string
  chapterTitle: string
  chapterNumber: number | null
  bookId: string
  bookTitle: string
  /** That appearance is on a non-canon branch (LOOM-78). */
  nonCanon?: boolean
}

export type TaggedEvent = WriterEvent & {
  alsoIn: EventAppearance[]
  /** Tagged as referenced only on a non-canon branch of this chapter
   *  (LOOM-78). Loom-only: the route WriteAI reads filters these out. */
  nonCanon: boolean
}

export function useChapterEvents(chapterId: string) {
  const [events, setEvents] = useState<WriterEvent[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [characterPool, setCharacterPool] = useState<CharacterOption[]>([])
  const [characterPhotos, setCharacterPhotos] = useState<Record<string, string | null>>({})
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  const [spread, setSpread] = useState<Record<string, EventAppearance[]>>({})
  const [nonCanonIds, setNonCanonIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Distinct from "no events": WriteAI being down must be SAYABLE. An empty
  // list would read as "this chapter references nothing", which is a lie.
  const [unreachable, setUnreachable] = useState(false)

  const chapterIdRef = useRef(chapterId)
  chapterIdRef.current = chapterId

  /** Loom's side: which ids are tagged here, plus each one's spread. */
  const loadTags = useCallback(async (id: string) => {
    const res = await fetch(`/api/chapters/${id}/events`)
    if (!res.ok) throw new Error(`tags ${res.status}`)
    const data: {
      events: { writerEventId: string; nonCanon?: boolean; alsoIn: EventAppearance[] }[]
    } = await res.json()
    if (chapterIdRef.current !== id) return
    setTaggedIds(data.events.map(e => e.writerEventId))
    setNonCanonIds(data.events.filter(e => e.nonCanon).map(e => e.writerEventId))
    setSpread(Object.fromEntries(data.events.map(e => [e.writerEventId, e.alsoIn])))
  }, [])

  /** WriteAI's side: every event. Small enough to hold whole (144 today), and
   *  a genuine side-effect-free read, unlike the characters endpoint. */
  const loadEvents = useCallback(async (id: string) => {
    const res = await fetch('/api/writeai/events')
    const data = await res.json().catch(() => null)
    if (chapterIdRef.current !== id) return
    if (!res.ok) {
      // 503 means WriteAI is not running — a state the tab renders explicitly.
      // Any other failure is a bug on our side and should be loud.
      if (res.status === 503 || data?.unreachable) {
        setUnreachable(true)
        setEvents([])
        return
      }
      throw new Error(`events ${res.status}`)
    }
    setUnreachable(false)
    setEvents(data?.events ?? [])
    // The location pool rides along with the list, so the modal's combobox
    // costs no extra request.
    setLocations(data?.locations ?? [])
  }, [])

  /**
   * WriteAI's writer-character names, for the modal's picker.
   *
   * Lazy and called on modal open, never on mount and never on a timer:
   * GET /api/plan/characters WRITES TO DISK — it seeds from canon on first
   * call, prunes entries canon has reclassified, and self-heals the `books`
   * field, saving whenever any of that changes. Treating it as a cheap read is
   * how a panel that merely opens starts rewriting writer data.
   */
  const loadCharacterPool = useCallback(async () => {
    try {
      const res = await fetch('/api/writeai/characters')
      if (!res.ok) return
      const data = await res.json()
      const rows: { id?: string; name?: string; photo_url?: string | null }[] = data?.characters ?? []
      // An entry without an id cannot be referenced at all now that events store
      // ids (LOOM-45), so it is dropped from the pool rather than offered as a
      // choice that could not be saved.
      const named = rows.filter(
        (c): c is { id: string; name: string; photo_url?: string | null } =>
          typeof c.name === 'string' && c.name.length > 0 && typeof c.id === 'string' && !!c.id,
      )
      setCharacterPool(
        named
          .map(c => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      // WriteAI serves portraits from its own origin; rewrite to Loom's proxy
      // so the browser never talks to :8000 and the no-cache header survives.
      setCharacterPhotos(
        Object.fromEntries(
          named.map(c => {
            const file = c.photo_url?.split('/').pop()
            return [c.name, file ? `/api/writeai/photo/${file}` : null]
          }),
        ),
      )
    } catch {
      // The picker degrades to "no characters found"; the form still saves.
    }
  }, [])

  const refresh = useCallback(async () => {
    const id = chapterIdRef.current
    setLoading(true)
    try {
      // Loom's tags load even when WriteAI is down, so switching WriteAI back on
      // and retrying does not need a chapter change to recover.
      await Promise.all([loadTags(id), loadEvents(id)])
    } catch {
      notify('error', "Couldn't load this chapter's events.")
    } finally {
      if (chapterIdRef.current === id) setLoading(false)
    }
  }, [loadTags, loadEvents])

  useEffect(() => {
    setEvents([])
    setTaggedIds([])
    setSpread({})
    setNonCanonIds([])
    setUnreachable(false)
    void refresh()
  }, [chapterId, refresh])

  /**
   * Tag or untag, optimistically.
   *
   * The server is idempotent in both directions — POST returns 200 for an
   * already-tagged event, DELETE returns 200 for an already-untagged one — so a
   * double click cannot desync. On failure the optimistic change is reverted
   * and a toast explains, rather than the row silently snapping back.
   */
  const setTagged = useCallback(
    async (writerEventId: string, tagged: boolean) => {
      const id = chapterIdRef.current
      const previous = taggedIds
      setTaggedIds(current =>
        tagged
          ? current.includes(writerEventId) ? current : [...current, writerEventId]
          : current.filter(e => e !== writerEventId),
      )
      try {
        const res = tagged
          ? await fetch(`/api/chapters/${id}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ writerEventId }),
            })
          : await fetch(`/api/chapters/${id}/events/${writerEventId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(String(res.status))
        // Re-read the spread: tagging here changes "also in" for every other
        // chapter this event appears in, and untagging can empty it.
        await loadTags(id)
      } catch {
        if (chapterIdRef.current === id) setTaggedIds(previous)
        notify('error', tagged ? "Couldn't tag that event." : "Couldn't remove that tag.")
      }
    },
    [taggedIds, loadTags],
  )

  /**
   * Flip a tag between canon and non-canon (LOOM-78).
   *
   * Optimistic like setTagged, and for the same reason: it is a switch, and a
   * switch that waits for a round trip before moving feels broken. A failure
   * reverts and says so rather than leaving the UI asserting something the
   * database does not agree with.
   */
  const setNonCanon = useCallback(
    async (writerEventId: string, nonCanon: boolean) => {
      const id = chapterIdRef.current
      const previous = nonCanonIds
      setNonCanonIds(current =>
        nonCanon
          ? current.includes(writerEventId) ? current : [...current, writerEventId]
          : current.filter(e => e !== writerEventId),
      )
      try {
        const res = await fetch(`/api/chapters/${id}/events/${writerEventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonCanon }),
        })
        if (!res.ok) throw new Error(String(res.status))
        // Re-read the spread: the flag rides on every OTHER chapter's view of
        // this event too, so "also in Ch. 7" can change meaning here.
        await loadTags(id)
      } catch {
        if (chapterIdRef.current === id) setNonCanonIds(previous)
        notify('error', "Couldn't change whether that tag is canon.")
      }
    },
    [nonCanonIds, loadTags],
  )

  const taggedSet = new Set(taggedIds)
  const nonCanonSet = new Set(nonCanonIds)
  // Tagged events, in WriteAI's order for now — the panel sorts. An id with no
  // matching event is dropped here: that is the degradation contract.
  const tagged: TaggedEvent[] = events
    .filter(e => taggedSet.has(e.id))
    .map(e => ({ ...e, alsoIn: spread[e.id] ?? [], nonCanon: nonCanonSet.has(e.id) }))

  return {
    events,
    locations,
    characterPool,
    characterPhotos,
    loadCharacterPool,
    tagged,
    taggedIds: taggedSet,
    /** Tag count for the header badge. Counts RESOLVED tags, so it agrees with
     *  what the list shows rather than with what the database holds. */
    count: tagged.length,
    loading,
    unreachable,
    setTagged,
    setNonCanon,
    refresh,
  }
}
