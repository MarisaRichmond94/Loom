import { NextResponse } from 'next/server'
import { reviewNumberForChapter } from '@/lib/crossAppJump'
import { loomBookTitle, writeaiBookNumber } from '@/lib/writeaiBooks'
import { callWriteAi, UNREACHABLE } from '@/lib/writeaiProxy'

// What WriteAI extracted for one chapter, for the editor's Insights tab
// (LOOM-91).
//
// WriteAI already assembles this view — `/api/books/{n}/chapters/{c}/extracted`
// collapses the chapter's chunk metadata onto canonical character names and
// adds the enriched prose summary. Loom's job is addressing (which chapter is
// that, over there?) and stripping the payload to what the tab renders.
//
// Unlike `GET /api/plan/characters`, the endpoint behind this is a PURE READ:
// it seeds nothing, prunes nothing and writes nothing. So it is safe to call on
// tab open. Do not "optimise" it into a poll anyway — it is a read of a store
// that only changes when an enrichment pass runs, which is daily at most.
//
// Read-only in the other direction too: nothing here writes back to WriteAI.

/** One fact as the tab renders it. `category` is hardcoded "revealed" upstream
 *  today; carried anyway so a real taxonomy later is a rendering change rather
 *  than a seam change. */
type Fact = { statement: string; category: string }

export type ChapterInsights = {
  /** The enriched prose summary, or null — see the `summary` fallback. */
  summaryText: string | null
  /** Key events, the per-chunk extraction. Doubles as the Summary section when
   *  `summaryText` is null, which is what WriteAI's own drawer does. */
  summary: string[]
  facts: Fact[]
  /** The chapter's date line. Not rendered today — see the panel's footer for
   *  why it is NOT a "last read on" timestamp. */
  date: string | null
}

// `locations` was a third section, and is gone. It shipped provisionally to
// find out whether a list of place names earned its space beside the summary
// and the facts; it did not. Dropped at the seam as well as in the panel, so
// the payload keeps saying exactly what the tab renders.

type Payload =
  | { insights: ChapterInsights; chapter: number }
  | { insights: null; reason: 'chapter-not-addressable' }
  | { insights: null; reason: 'not-analyzed'; chapter: number }
  | { insights: null; reason: 'writeai-unavailable'; detail?: string }

/**
 * WriteAI being down, or not knowing this chapter, must not read as an error
 * the writer has to dismiss — the tab says so in words and carries on. A
 * genuine upstream fault (a 500, a malformed response) is a different thing and
 * keeps its status, so it stays visible as a fault instead of being flattened
 * into "nothing here yet".
 *
 * Mirrors api/writeai/review/route.ts, which made the same call for the same
 * reason: a chapter with no review is the ordinary case, not a failure.
 */
async function classify(
  response: Response,
  chapter: number,
): Promise<{ payload: Payload } | { passthrough: Response }> {
  const body = await response.clone().json().catch(() => null)
  if (response.status === UNREACHABLE) {
    return {
      payload: { insights: null, reason: 'writeai-unavailable', detail: body?.detail },
    }
  }
  // 404 means WriteAI has the book but no chunks for this chapter — written
  // since the last ingest. Expected, and not the same thing as an error.
  if (body?.upstreamStatus === 404) {
    return { payload: { insights: null, reason: 'not-analyzed', chapter } }
  }
  return { passthrough: response }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  const bookId = url.searchParams.get('bookId')
  const chapterId = url.searchParams.get('chapterId')
  if (!seriesId || !bookId || !chapterId) {
    return NextResponse.json(
      { error: 'seriesId, bookId and chapterId are required' },
      { status: 400 },
    )
  }

  // The book must exist before anything else is worth saying about it. An
  // unknown id is a caller bug and keeps its 404 — reporting it as "this
  // chapter has no address" would be true of a chapter that does not exist, and
  // useless to whoever typed the wrong id.
  const title = await loomBookTitle(seriesId, bookId)
  if (title === null) return NextResponse.json({ error: 'unknown book' }, { status: 404 })

  // No canon address — an unnumbered chapter that is not the prologue — means
  // WriteAI has no name for this chapter and cannot have analysed it. Resolved
  // BEFORE any WriteAI call, because the answer does not depend on one.
  //
  // Read-only on purpose: the canon export returns the same number but writes
  // the manuscript to ~/Writing on its way there, and this runs on tab open.
  const chapter = await reviewNumberForChapter(seriesId, bookId, chapterId)
  if (chapter === null) {
    return NextResponse.json({ insights: null, reason: 'chapter-not-addressable' } satisfies Payload)
  }

  const resolved = await writeaiBookNumber(title)
  if ('response' in resolved) {
    const outcome = await classify(resolved.response, chapter)
    return 'payload' in outcome ? NextResponse.json(outcome.payload) : outcome.passthrough
  }
  // A book WriteAI has never ingested is not an error — from the writer's side
  // it is the same story as an unanalysed chapter, and not worth a fourth empty
  // state.
  if (resolved.number === null) {
    return NextResponse.json({ insights: null, reason: 'not-analyzed', chapter } satisfies Payload)
  }

  const result = await callWriteAi(
    `/api/books/${resolved.number}/chapters/${chapter}/extracted`,
    { cache: 'no-store' },
  )
  if ('response' in result) {
    const outcome = await classify(result.response, chapter)
    return 'payload' in outcome ? NextResponse.json(outcome.payload) : outcome.passthrough
  }

  const data = (result.data ?? {}) as {
    summary_text?: string | null
    summary?: unknown
    facts?: unknown
    date?: string | null
  }

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []

  const facts: Fact[] = Array.isArray(data.facts)
    ? (data.facts as { statement?: unknown; category?: unknown }[])
        .filter(f => typeof f?.statement === 'string' && f.statement.trim() !== '')
        .map(f => ({
          statement: f.statement as string,
          category: typeof f.category === 'string' ? f.category : 'revealed',
        }))
    : []

  const insights: ChapterInsights = {
    // Independently nullable: a WriteAI database predating LOOM-65's column
    // returns null here while the rest of the payload is fine.
    summaryText: typeof data.summary_text === 'string' && data.summary_text.trim() !== ''
      ? data.summary_text
      : null,
    summary: strings(data.summary),
    facts,
    date: typeof data.date === 'string' && data.date.trim() !== '' ? data.date : null,
  }

  // Everything empty is indistinguishable from an unanalysed chapter, and the
  // tab has a better sentence for that than two blank sections.
  const empty =
    insights.summaryText === null &&
    insights.summary.length === 0 &&
    insights.facts.length === 0
  if (empty) {
    return NextResponse.json({ insights: null, reason: 'not-analyzed', chapter } satisfies Payload)
  }

  return NextResponse.json({ insights, chapter } satisfies Payload)
}

/**
 * The characters WriteAI extracted are deliberately NOT in the payload.
 *
 * They are a chunk-derived, degraded view of the same people the Characters tab
 * shows from the writer's own tags — same names, worse provenance. Shipping
 * both would put two disagreeing rosters one tab apart. Dropped here rather
 * than hidden in the panel so a second consumer cannot quietly grow on them.
 */
