'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookChapterRow } from '@/lib/bookChapterTags'

// Loom's side of the Chapters tab (LOOM-120/121).
//
// One query plus one canon walk, against Loom's own tables. Deliberately NOT
// merged with the outline fetch: this must render whether or not WriteAI is up.
// A book's chapter sequence is Loom's to know, and a tab that goes blank
// because the other app is down would be hiding data it already has in hand.
//
// The summaries are the part that needs WriteAI, and they are joined in the
// component — missing summaries degrade to an empty card, never to an empty tab.

export type BookChapterTags = {
  chapters: BookChapterRow[]
  loading: boolean
  /** Distinct from "no chapters": a failed read must be sayable. An empty list
   *  would read as "this book has nothing in it", which is a lie. */
  failed: boolean
  refresh: () => Promise<void>
}

export function useBookChapterTags(seriesId: string, bookId: string): BookChapterTags {
  const [chapters, setChapters] = useState<BookChapterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  // Guards a response for the previous book landing in the current one —
  // reachable by switching books with this tab already open. Same guard
  // useBookOutline carries, for the same reason.
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  const load = useCallback(async () => {
    const id = bookIdRef.current
    setLoading(true)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${id}/chapter-tags`)
      const data = await res.json().catch(() => null)
      if (bookIdRef.current !== id) return
      if (!res.ok || !Array.isArray(data?.chapters)) {
        setChapters([])
        setFailed(true)
        return
      }
      setChapters(data.chapters)
      setFailed(false)
    } catch {
      if (bookIdRef.current !== id) return
      setChapters([])
      setFailed(true)
    } finally {
      if (bookIdRef.current === id) setLoading(false)
    }
  }, [seriesId])

  useEffect(() => {
    void load()
  }, [bookId, load])

  return { chapters, loading, failed, refresh: load }
}
