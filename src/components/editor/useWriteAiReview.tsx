'use client'

import { useRef, useState } from 'react'
import { notify, setNotificationBusy } from '@/lib/notifications'

// "Review in WriteAI" — the chapter header's Review button. Saves the book's
// canon manuscript to disk (the same export WriteAI ingests from), then hands
// off to WriteAI's review page with the book, chapter, and reviewer persona
// pre-selected and the chapter preview open. `draft=1` tells WriteAI to read
// the chapter's text straight from the freshly exported file (no ingest, no
// LLM cost) so the writer can iterate review→revise→re-review and only
// reindex once the revision lands. Loom's side of the contract ends at
// "file on disk + URL" — it never calls WriteAI's API.

const REVIEW_FOCUS = 'Literary Agent'

export function useWriteAiReview(seriesId: string) {
  const busyRef = useRef(false)
  const [reviewing, setReviewing] = useState(false)

  async function reviewInWriteAi(book: { id: string; title: string } | undefined, chapterId: string) {
    if (!book || busyRef.current) return
    busyRef.current = true
    setReviewing(true)
    setNotificationBusy(true)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${book.id}/export/canon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId }),
      })
      const data = await res.json() as { ok?: boolean; reviewChapter?: number | null; error?: string }
      if (!res.ok || !data.ok) {
        notify('error', data.error ?? 'Canon save failed — review not started.')
        return
      }
      const params = new URLSearchParams({
        pane: 'review',
        book: book.title,
        focus: REVIEW_FOCUS,
        preview: '1',
        draft: '1',
      })
      // Unnumbered non-prologue chapters (and chapters the canon walk skips)
      // have no address in WriteAI; omitting the param lands on the book with
      // the chapter dropdown left for the writer.
      if (typeof data.reviewChapter === 'number') {
        params.set('chapter', String(data.reviewChapter))
      }
      const base = process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:5173'
      window.location.href = `${base}/?${params.toString()}`
    } catch {
      notify('error', 'Canon save failed — review not started.')
    } finally {
      busyRef.current = false
      setReviewing(false)
      setNotificationBusy(false)
    }
  }

  return { reviewInWriteAi, reviewing }
}
