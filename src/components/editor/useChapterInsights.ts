'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// The Insights tab's data (LOOM-92).
//
// Much simpler than useChapterEvents / useChapterCharacters: one source, no
// Loom-side join, no mutations. Everything here is WriteAI's reading of a
// chapter — Loom contributes only the address.
//
// The `reason` is the point of this hook. Four outcomes look identical if you
// only carry the payload, and the tab needs a different sentence for each: a
// chapter with no canon address is permanently unanalysable, one that has not
// been ingested yet is the ordinary state of anything written today, and
// WriteAI being down is neither.

export type ChapterInsights = {
  summaryText: string | null
  summary: string[]
  facts: { statement: string; category: string }[]
  date: string | null
}

export type InsightsReason = 'chapter-not-addressable' | 'not-analyzed' | 'writeai-unavailable'

/**
 * The summary the writer wrote on the Outline tab (ChapterSummary), or null.
 *
 * Read only when WriteAI has nothing for the chapter: the tab then shows what
 * she planned instead of an empty state — the normal case for a chapter in a
 * book WriteAI has never seen. Loom's own table, so it is there even when
 * WriteAI is down. "" (she chose the AI summary) reads as none: the AI summary
 * it points at is WriteAI's, which is exactly what is missing.
 */
async function readOutlineSummary(chapterId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/chapters/${chapterId}/summary`)
    if (!res.ok) return null
    const data = (await res.json()) as { body?: string }
    return data.body?.trim() ? data.body : null
  } catch {
    return null
  }
}

export function useChapterInsights(
  seriesId: string,
  bookId: string | undefined,
  chapterId: string,
  /** Only fetch once the tab is actually open — see below. */
  active: boolean,
) {
  const [insights, setInsights] = useState<ChapterInsights | null>(null)
  const [reason, setReason] = useState<InsightsReason | null>(null)
  const [outlineSummary, setOutlineSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Guards against a response for the previous chapter landing in the current
  // one. Same pattern as useChapterCharacters — arrowing through chapters with
  // the dock open makes this a normal occurrence, not a race you have to
  // engineer.
  const chapterIdRef = useRef(chapterId)
  chapterIdRef.current = chapterId

  const load = useCallback(
    async (id: string) => {
      if (!bookId) {
        // No book in context means no canon address to resolve. Treated as the
        // unaddressable case rather than an error, because it is the same fact.
        setInsights(null)
        setReason('chapter-not-addressable')
        const own = await readOutlineSummary(id)
        if (chapterIdRef.current === id) setOutlineSummary(own)
        return
      }
      setLoading(true)
      // Cleared up front, so a previous chapter's summary never shows under
      // this one's empty state.
      setOutlineSummary(null)
      let empty = true
      try {
        const res = await fetch(
          `/api/writeai/insights?seriesId=${seriesId}&bookId=${bookId}&chapterId=${id}`,
        )
        const data = await res.json().catch(() => null)
        if (chapterIdRef.current !== id) return
        if (!res.ok) {
          // The proxy answers every expected empty case at 200, so a non-2xx
          // here is a genuine fault. Report it as WriteAI being unavailable —
          // it is the state with a retry, which is the only useful action.
          setInsights(null)
          setReason('writeai-unavailable')
          return
        }
        empty = !data?.insights
        setInsights(data?.insights ?? null)
        setReason(data?.insights ? null : (data?.reason ?? 'not-analyzed'))
      } catch {
        if (chapterIdRef.current !== id) return
        setInsights(null)
        setReason('writeai-unavailable')
      } finally {
        if (empty && chapterIdRef.current === id) {
          const own = await readOutlineSummary(id)
          if (chapterIdRef.current === id) setOutlineSummary(own)
        }
        if (chapterIdRef.current === id) setLoading(false)
      }
    },
    [seriesId, bookId],
  )

  // On tab open and on chapter change — never on a timer. The endpoint behind
  // this is a pure read, so a poll would not corrupt anything the way polling
  // the plan-characters endpoint would; it would just be work nobody asked for,
  // over data that changes once an enrichment pass.
  useEffect(() => {
    if (!active) return
    void load(chapterId)
  }, [active, chapterId, load])

  const onRetry = useCallback(() => {
    void load(chapterIdRef.current)
  }, [load])

  return { insights, reason, outlineSummary, loading, onRetry }
}
