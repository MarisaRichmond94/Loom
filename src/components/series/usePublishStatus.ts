'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Publish state for a series, per book (LOOM-129).
 *
 * A hook rather than a panel component because the controls belong ON the book
 * cards — publishing is a per-book act, and the author reads "can my family
 * read this?" while looking at the book, not at a separate summary above it.
 *
 * Keeps two things separate that the UI must not conflate:
 *   - `eligible`  — marked Published in Loom; ALLOWED to be read
 *   - `inSnapshot` — actually in readers' hands right now
 * A book can be the first without the second until you publish it.
 */

export type BookPublishStatus = {
  id: string
  title: string
  order: number
  eligible: boolean
  inSnapshot: boolean
  changed: boolean
  publishedAt: string | null
  chapters: number
  narrated: number
  narrationMismatched: string[]
  warnings: string[]
}

export type PublishStatus = {
  publishedAt: string | null
  everPublished: boolean
  stale: boolean
  books: BookPublishStatus[]
}

export type PublishOutcome = {
  bookId: string
  title: string
  chapters: number
  blocks: number
  narrated: number
  narrationMismatched: string[]
  carried: number
  warnings: string[]
  assets?: { linked: number; copied: number; pruned: number; missing: string[] }
}

export function usePublishStatus(seriesId: string) {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [busyBookId, setBusyBookId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${seriesId}/publish`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not read publish status')
      setStatus(body)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read publish status')
    }
  }, [seriesId])

  useEffect(() => { refresh() }, [refresh])

  const publish = useCallback(async (bookId: string) => {
    setBusyBookId(bookId)
    setError(null)
    setOutcome(null)
    try {
      const res = await fetch(`/api/series/${seriesId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: [bookId] }),
      })
      const body = await res.json()
      // A refusal is a real outcome — an overlapping asset root, a locked
      // database. Surface it; a button that silently does nothing is worse.
      if (!res.ok) throw new Error(body.error ?? 'Publish failed')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mine = (body.books as any[]).find(b => b.id === bookId)
      setOutcome({
        bookId,
        title: mine?.title ?? '',
        chapters: mine?.chapters ?? 0,
        blocks: mine?.blocks ?? 0,
        narrated: mine?.narrated ?? 0,
        narrationMismatched: mine?.narrationMismatched ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        carried: (body.books as any[]).filter(b => b.source === 'carried').length,
        warnings: body.warnings ?? [],
        assets: body.assets,
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setBusyBookId(null)
    }
  }, [seriesId, refresh])

  const byId = useCallback(
    (bookId: string) => status?.books.find(b => b.id === bookId) ?? null,
    [status],
  )

  return { status, byId, publish, busyBookId, outcome, error, refresh }
}
