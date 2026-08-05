'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OutlineCard } from '@/lib/writerOutline'
import { invalidateOutlineCache, prefetchBookOutline } from './outlineCache'
import type { BookOutline, OutlineReason } from './outlineCache'

export type { OutlineSyncState, BookOutline, OutlineReason } from './outlineCache'

// The Outline section's data (LOOM-96).
//
// ⚠️ The endpoint behind this is NOT a pure read. WriteAI's `get_outline` seeds
// a missing outline from canon, runs auto-reconcile, and SAVES — all on a GET.
// So this fetches on section open and after mutations, and never on a timer.
// Opening the section for a book that has never been planned legitimately
// creates its outline; that is WriteAI's design, not an accident here.

/**
 * Fetches on mount, going through outlineCache's `prefetchBookOutline` so a
 * page-level idle prefetch (kicked off before the Outline tab is ever
 * clicked, to avoid the pop-in of content arriving after the tab strip
 * animation has already settled) and this hook's own mount land on the same
 * request rather than firing the GET twice.
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
    // `fresh` bypasses the cache — used after a retry or a mutation, where
    // serving back whatever a prefetch happened to capture would be stale.
    async (id: string, opts?: { fresh?: boolean }) => {
      setLoading(true)
      try {
        if (opts?.fresh) invalidateOutlineCache(seriesId, id)
        const { outline: fetched, reason: fetchedReason } = await prefetchBookOutline(seriesId, id)
        if (bookIdRef.current !== id) return
        setOutline(fetched)
        setReason(fetchedReason)
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
    void load(bookIdRef.current, { fresh: true })
  }, [load])

  // ── Mutations (LOOM-97) ───────────────────────────────────────────────────
  //
  // Every content change is a whole-list PUT, because WriteAI offers no
  // per-card update. So each of these is a read-modify-write over the cards
  // currently in state — which is exactly why `apply` takes a function of the
  // current list rather than a prebuilt one, and why the response is trusted
  // over local state afterwards.

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Replace the list, from a transform of the current one. */
  const apply = useCallback(
    async (transform: (cards: OutlineCard[]) => OutlineCard[]) => {
      const id = bookIdRef.current
      const current = outline?.cards
      if (!current) return false

      const next = transform(current)
      // Optimistic: a drag that waits for a round trip before the card moves
      // feels broken. Rolled back below if the save fails.
      setOutline(o => (o ? { ...o, cards: next } : o))
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/writeai/outline?seriesId=${seriesId}&bookId=${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapters: next }),
        })
        const data = await res.json().catch(() => null)
        if (bookIdRef.current !== id) return false
        if (!res.ok) {
          setOutline(o => (o ? { ...o, cards: current } : o))
          setError(data?.error ?? 'Could not save the outline.')
          return false
        }
        // WriteAI's PUT returns get_outline(), which re-runs auto-reconcile —
        // the list coming back can legitimately differ from the one sent, and
        // it is the truth. Trusting local state here is how a client drifts
        // from the store it is editing.
        const returned: OutlineCard[] = Array.isArray(data?.outline?.chapters)
          ? data.outline.chapters
          : next
        setOutline({
          cards: [...returned].sort((a, b) => a.position - b.position),
          syncState: data?.outline?.sync_state ?? 'unknown',
        })
        // The response above is already fresh; this just keeps a later mount
        // (switching away from and back to this book) from reading the
        // pre-edit cache entry.
        invalidateOutlineCache(seriesId, id)
        return true
      } catch {
        if (bookIdRef.current !== id) return false
        setOutline(o => (o ? { ...o, cards: current } : o))
        setError('WriteAI isn’t reachable, so nothing was saved.')
        return false
      } finally {
        if (bookIdRef.current === id) setSaving(false)
      }
    },
    [seriesId, outline?.cards],
  )

  /**
   * Edit one card's writer-owned fields.
   *
   * Spread over the EXISTING card rather than built from the form, so every
   * field the form does not render — `loom_id`, `summary_source`,
   * `extracted_bullets`, and anything WriteAI adds later — survives the save.
   * That is the whole ballgame with a store that replaces rather than merges.
   */
  const editCard = useCallback(
    (id: string, changes: Partial<OutlineCard>) =>
      apply(cards => cards.map(c => (c.id === id ? { ...c, ...changes } : c))),
    [apply],
  )

  /** Reorder by POSITION only — never by chapter number, which belongs to the
   *  manuscript and is re-derived by the backend from Loom's manifest. */
  const reorder = useCallback(
    (orderedIds: string[]) =>
      apply(cards => {
        const byId = new Map(cards.map(c => [c.id, c]))
        return orderedIds
          .map(id => byId.get(id))
          .filter((c): c is OutlineCard => Boolean(c))
          .map((c, i) => ({ ...c, position: i + 1 }))
      }),
    [apply],
  )

  /**
   * Add a planned card at a fractional position.
   *
   * POST rather than a whole-list PUT: it touches one card, so it cannot lose
   * the book to a partial body. The list is refetched afterwards because the
   * endpoint returns only the new card.
   */
  const addCard = useCallback(
    async (position: number, heading: string) => {
      const id = bookIdRef.current
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/writeai/outline/chapter?seriesId=${seriesId}&bookId=${id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position, heading }),
          },
        )
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setError(data?.error ?? 'Could not add the card.')
          return false
        }
        await load(id, { fresh: true })
        return true
      } catch {
        setError('WriteAI isn’t reachable, so nothing was added.')
        return false
      } finally {
        if (bookIdRef.current === id) setSaving(false)
      }
    },
    [seriesId, load],
  )

  /** Remove one card. Deleting a SYNCED card removes the planning card, not the
   *  chapter — the manuscript is Loom's and this endpoint cannot touch it. */
  const deleteCard = useCallback(
    async (cardId: string) => {
      const id = bookIdRef.current
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/writeai/outline/chapter?seriesId=${seriesId}&bookId=${id}&cardId=${encodeURIComponent(cardId)}`,
          { method: 'DELETE' },
        )
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setError(data?.error ?? 'Could not delete the card.')
          return false
        }
        await load(id, { fresh: true })
        return true
      } catch {
        setError('WriteAI isn’t reachable, so nothing was deleted.')
        return false
      } finally {
        if (bookIdRef.current === id) setSaving(false)
      }
    },
    [seriesId, load],
  )

  return { outline, reason, loading, onRetry, saving, error, editCard, reorder, addCard, deleteCard }
}
