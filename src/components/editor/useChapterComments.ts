'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AuthorComment, CommentsResult } from '@/lib/readerComments'

// The Comments tab's data (LOOM-135).
//
// Same shape as useChapterInsights: an outside store, surfaced in context. The
// difference is that this one has two mutations — resolve and hide — and they
// mean different things to different people. Resolving is the author's own
// bookkeeping; hiding changes what her family sees.

export type { AuthorComment }

export function useChapterComments(
  bookId: string | undefined,
  chapterId: string,
  /**
   * Whether the tab is open. Unlike Insights this does NOT gate the fetch — the
   * badge has to be right while the tab is closed, or it cannot do the one job
   * it has, which is telling the author something arrived. Opening the tab
   * refetches so a comment posted while it sat open still appears.
   *
   * Affordable because this is a local SQLite read, not a WriteAI round trip.
   */
  active: boolean,
) {
  const [data, setData] = useState<CommentsResult | null>(null)
  const [loading, setLoading] = useState(false)

  // Guards against a response for the previous chapter landing in the current
  // one — arrowing through chapters with the dock open makes that ordinary.
  const forChapter = useRef<string>('')

  const load = useCallback(async () => {
    if (!bookId || !chapterId) return
    forChapter.current = chapterId
    setLoading(true)
    try {
      const res = await fetch(
        `/api/reader/comments?bookId=${encodeURIComponent(bookId)}&chapterId=${encodeURIComponent(chapterId)}`,
      )
      const next = res.ok ? await res.json() as CommentsResult : null
      if (forChapter.current === chapterId) setData(next)
    } catch {
      if (forChapter.current === chapterId) setData(null)
    } finally {
      if (forChapter.current === chapterId) setLoading(false)
    }
  }, [bookId, chapterId])

  useEffect(() => {
    void load()
  }, [load, active])

  /** Optimistic, then reconciled — the dock should not feel like a form. */
  const mutate = useCallback(
    async (id: string, patch: { resolved?: boolean; hidden?: boolean }) => {
      setData(d => d && {
        ...d,
        chapter: d.chapter.map(c => (c.id === id ? { ...c, ...patch } : c)),
        orphaned: d.orphaned.map(c => (c.id === id ? { ...c, ...patch } : c)),
      })
      await fetch(`/api/reader/comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      void load()
    },
    [load],
  )

  return { data, loading, reload: load, mutate }
}
