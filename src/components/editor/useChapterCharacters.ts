'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from '@/lib/notifications'
import type { WriterCharacter } from '@/lib/characterSearch'
import type { ChapterAppearance } from '@/lib/chapterTags'

// The Characters tab's data (LOOM-33 / LOOM-44).
//
// Same two-source shape as useChapterEvents: Loom knows which ids are tagged
// here and where else they appear; WriteAI knows who they are. The join
// happens on the client, so an id WriteAI no longer knows simply drops out —
// unknown identity, hidden rather than errored.
//
// That last case is NOT rare here. WriteAI's GET /api/plan/characters prunes
// auto-seeded entries its classifier has since decided are not characters, so
// a tagged id can disappear through ordinary use rather than deliberate
// deletion.

export type TaggedCharacter = WriterCharacter & {
  alsoIn: ChapterAppearance[]
  /** Tagged as appearing only on a non-canon branch of this chapter (LOOM-63).
   *  Loom-only: the route WriteAI reads filters these out. */
  nonCanon: boolean
}

export function useChapterCharacters(chapterId: string) {
  const [characters, setCharacters] = useState<WriterCharacter[]>([])
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  const [spread, setSpread] = useState<Record<string, ChapterAppearance[]>>({})
  const [nonCanonIds, setNonCanonIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [unreachable, setUnreachable] = useState(false)

  const chapterIdRef = useRef(chapterId)
  chapterIdRef.current = chapterId

  const loadTags = useCallback(async (id: string) => {
    const res = await fetch(`/api/chapters/${id}/characters`)
    if (!res.ok) throw new Error(`tags ${res.status}`)
    const data: {
      characters: { writerCharacterId: string; nonCanon?: boolean; alsoIn: ChapterAppearance[] }[]
    } = await res.json()
    if (chapterIdRef.current !== id) return
    setTaggedIds(data.characters.map(c => c.writerCharacterId))
    setNonCanonIds(data.characters.filter(c => c.nonCanon).map(c => c.writerCharacterId))
    setSpread(Object.fromEntries(data.characters.map(c => [c.writerCharacterId, c.alsoIn])))
  }, [])

  /**
   * WriteAI's character pool.
   *
   * ⚠️ GET /api/plan/characters WRITES TO DISK — it seeds from canon on first
   * call, prunes reclassified entries, and self-heals `books`, saving whenever
   * any of that changes. Unlike the events list this is not a free read, so it
   * happens on mount and after mutations, never on a timer.
   */
  const loadCharacters = useCallback(async (id: string) => {
    const res = await fetch('/api/writeai/characters')
    const data = await res.json().catch(() => null)
    if (chapterIdRef.current !== id) return
    if (!res.ok) {
      if (res.status === 503 || data?.unreachable) {
        setUnreachable(true)
        setCharacters([])
        return
      }
      throw new Error(`characters ${res.status}`)
    }
    setUnreachable(false)
    setCharacters(data?.characters ?? [])
  }, [])

  const refresh = useCallback(async () => {
    const id = chapterIdRef.current
    setLoading(true)
    try {
      await Promise.all([loadTags(id), loadCharacters(id)])
    } catch {
      notify('error', "Couldn't load this chapter's characters.")
    } finally {
      if (chapterIdRef.current === id) setLoading(false)
    }
  }, [loadTags, loadCharacters])

  useEffect(() => {
    setCharacters([])
    setTaggedIds([])
    setSpread({})
    setUnreachable(false)
    void refresh()
  }, [chapterId, refresh])

  /** Tag or untag, optimistically. Both directions are idempotent server-side,
   *  so a double click cannot desync; a failure reverts and explains. */
  const setTagged = useCallback(
    async (writerCharacterId: string, tagged: boolean) => {
      const id = chapterIdRef.current
      const previous = taggedIds
      setTaggedIds(current =>
        tagged
          ? current.includes(writerCharacterId) ? current : [...current, writerCharacterId]
          : current.filter(c => c !== writerCharacterId),
      )
      try {
        const res = tagged
          ? await fetch(`/api/chapters/${id}/characters`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ writerCharacterId }),
            })
          : await fetch(`/api/chapters/${id}/characters/${writerCharacterId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(String(res.status))
        await loadTags(id)
      } catch {
        if (chapterIdRef.current === id) setTaggedIds(previous)
        notify('error', tagged ? "Couldn't tag that character." : "Couldn't remove that tag.")
      }
    },
    [taggedIds, loadTags],
  )

  /**
   * Flip a tag between canon and non-canon (LOOM-63).
   *
   * Optimistic like setTagged, and for the same reason: it is a switch, and a
   * switch that waits for a round trip before moving feels broken. A failure
   * reverts and says so rather than leaving the UI asserting something the
   * database does not agree with.
   */
  const setNonCanon = useCallback(
    async (writerCharacterId: string, nonCanon: boolean) => {
      const id = chapterIdRef.current
      const previous = nonCanonIds
      setNonCanonIds(current =>
        nonCanon
          ? current.includes(writerCharacterId) ? current : [...current, writerCharacterId]
          : current.filter(c => c !== writerCharacterId),
      )
      try {
        const res = await fetch(`/api/chapters/${id}/characters/${writerCharacterId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonCanon }),
        })
        if (!res.ok) throw new Error(String(res.status))
        await loadTags(id)
      } catch {
        if (chapterIdRef.current === id) setNonCanonIds(previous)
        notify('error', "Couldn't change whether that tag is canon.")
      }
    },
    [nonCanonIds, loadTags],
  )

  /**
   * Change a character's category from the row.
   *
   * Sends the COMPLETE character, because WriteAI stores the PUT body verbatim
   * — a partial body would delete every field it omitted. That is also why
   * this takes the whole record rather than just an id and a category.
   *
   * Optimistic, and reverted on failure: this control sits inside a card that
   * also expands on click, so a silent no-op would be easy to misread as
   * "it saved".
   */
  const setCategory = useCallback(
    async (character: WriterCharacter, category: string) => {
      const previous = characters
      setCharacters(cs => cs.map(c => (c.id === character.id ? { ...c, category } : c)))
      try {
        const res = await fetch(`/api/writeai/characters/${character.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...character, category }),
        })
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        setCharacters(previous)
        notify('error', `Couldn't change ${character.name}'s category.`)
      }
    },
    [characters],
  )

  const taggedSet = new Set(taggedIds)
  const nonCanonSet = new Set(nonCanonIds)
  const tagged: TaggedCharacter[] = characters
    .filter(c => taggedSet.has(c.id))
    .map(c => ({ ...c, alsoIn: spread[c.id] ?? [], nonCanon: nonCanonSet.has(c.id) }))

  return {
    characters,
    tagged,
    taggedIds: taggedSet,
    /** Counts RESOLVED tags, so the badge agrees with what the list shows
     *  rather than with what the database holds. */
    count: tagged.length,
    loading,
    unreachable,
    setTagged,
    setNonCanon,
    setCategory,
    refresh,
  }
}
