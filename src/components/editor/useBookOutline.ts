'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OutlineCard } from '@/lib/writerOutline'

// The Outline section's data (LOOM-96).
//
// ⚠️ The endpoint behind this is NOT a pure read. WriteAI's `get_outline` seeds
// a missing outline from canon, runs auto-reconcile, and SAVES — all on a GET.
// So this fetches on section open and after mutations, and never on a timer.
// Opening the section for a book that has never been planned legitimately
// creates its outline; that is WriteAI's design, not an accident here.

export type OutlineSyncState = 'synced' | 'behind' | 'unknown'

export type BookOutline = {
  cards: OutlineCard[]
  /** WriteAI returns this as `sync_state`; normalised here so the component
   *  never has to know which side of the seam it came from. */
  syncState: OutlineSyncState
}

export type OutlineReason = 'book-not-in-writeai' | 'writeai-unavailable'

/**
 * Fetches on mount, which IS the gate: the book page's tab strip mounts only
 * the active section, so this hook does not run until the Outline tab is
 * opened. That matters more than usual here — see the write-on-read warning
 * above. Nothing takes an `active` flag because nothing needs one.
 */
export function useBookOutline(seriesId: string, bookId: string) {
  const [outline, setOutline] = useState<BookOutline | null>(null)
  const [reason, setReason] = useState<OutlineReason | null>(null)
  const [loading, setLoading] = useState(false)

  // Guards a response for the previous book landing in the current one —
  // reachable by switching books with the Outline tab already open.
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  const load = useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const res = await fetch(`/api/writeai/outline?seriesId=${seriesId}&bookId=${id}`)
        const data = await res.json().catch(() => null)
        if (bookIdRef.current !== id) return

        if (!res.ok) {
          setOutline(null)
          setReason('writeai-unavailable')
          return
        }
        // The proxy answers "WriteAI has never ingested this book" at 200 with a
        // reason, because it is a state rather than a failure.
        if (!data?.outline) {
          setOutline(null)
          setReason(data?.reason === 'book-not-in-writeai' ? 'book-not-in-writeai' : 'writeai-unavailable')
          return
        }

        const cards: OutlineCard[] = Array.isArray(data.outline.chapters) ? data.outline.chapters : []
        setOutline({
          // Position, not array order: the store is a list WriteAI appends to,
          // so a card added between two others arrives last and sorts into
          // place here. Getting this wrong shows every inserted card at the end.
          cards: [...cards].sort((a, b) => a.position - b.position),
          syncState: data.outline.sync_state ?? 'unknown',
        })
        setReason(null)
      } catch {
        if (bookIdRef.current !== id) return
        setOutline(null)
        setReason('writeai-unavailable')
      } finally {
        if (bookIdRef.current === id) setLoading(false)
      }
    },
    [seriesId],
  )

  useEffect(() => {
    void load(bookId)
  }, [bookId, load])

  const onRetry = useCallback(() => {
    void load(bookIdRef.current)
  }, [load])

  return { outline, reason, loading, onRetry }
}
