// The outline for a NON-CANON book (LOOM-153, under LOOM-146).
//
// Canon books get their outline from WriteAI's `plan_outline.json`, proxied and
// keyed by Loom's book cuid. A non-canon book is never exported, so never
// ingested, so `resolveWriteaiBook` answers "unknown book" and there is no
// store on that side to hold anything. WriteAI must not be made to hold it
// either: it holds canon only.
//
// ── WHAT IS DERIVED, AND WHAT IS STORED ──────────────────────────────────────
//
// Chapter-backed cards are DERIVED at read time — one per chapter, from the
// chapter itself, with the summary coming from ChapterSummary (the table
// LOOM-120 added for exactly this case: "a chapter WriteAI cannot describe").
//
// ⚠️ Deriving rather than seeding is the point. WriteAI's own `get_outline`
// seeds a missing outline from canon and SAVES, on a GET — and the three
// "opened but not used must not write" guards from LOOM-91..97 exist because
// that behaviour crossed into Loom once already. Opening this tab writes
// nothing.
//
// Only a card with no chapter behind it — a plan for prose not yet written —
// has nowhere to be derived from. That is BookOutlinePlaceholder, and that is
// all it holds.
//
// ── WHY THIS IS SIMPLER THAN THE CANON PATH ──────────────────────────────────
//
// It sheds every hazard the proxy carries, and should stay that way:
//   - no whole-list-replace PUT that deletes anything missing from the body
//     (the reason writerOutline.ts's validator exists at all)
//   - no last-write-wins between two open editors
//   - no `_auto_reconcile` pruning cards whose loom_id is absent from a manifest
//
// The fields WriteAI's card carries for its extraction pipeline —
// `extracted_bullets`, `summary_source`, `status: 'synced'` — are deliberately
// absent: per LOOM-146 this iteration has no auto-generated summaries, so there
// is nothing for them to hold.

import type { OutlineCard } from '@/lib/writerOutline'

export type LocalChapterRow = {
  id: string
  title: string
  order: number
  pov: string | null
  date: string | null
  numbered: boolean
  summary?: { body: string } | null
}

export type LocalPlaceholderRow = {
  id: string
  position: number
  heading: string
  pov: string
  date: string | null
  summary: string
  notes: string | null
}

/**
 * Prefix marking a card id as a placeholder rather than a chapter cuid.
 *
 * `ph_` rather than something more readable like `placeholder:` so the id still
 * passes isSafeOutlineCardId, which allows only [A-Za-z0-9._-] — the guard the
 * delete path already runs, and which exists because the photo-glob incident
 * (LOOM-43) showed what an unvalidated id reaching a lookup costs. Fitting the
 * guard beats widening it.
 *
 * Cannot collide with a chapter cuid: those are lowercase alphanumeric starting
 * with 'c', so none can begin with 'ph_'.
 */
export const PLACEHOLDER_PREFIX = 'ph_'

export const isPlaceholderCardId = (cardId: string) => cardId.startsWith(PLACEHOLDER_PREFIX)
export const placeholderIdFromCardId = (cardId: string) => cardId.slice(PLACEHOLDER_PREFIX.length)

/**
 * The book's outline: chapters in order, with placeholders sorted in among them
 * by position.
 *
 * Positions are 1-based over the CHAPTERS, so a placeholder at 3.5 sits between
 * chapters 3 and 4. Chapter-backed cards take their position from chapter order
 * and are never renumbered by adding a placeholder — which is what lets a
 * placeholder be inserted without touching a single chapter row.
 *
 * Pure: the caller does the queries and passes rows in, so the ordering and
 * numbering rules are testable without a database.
 */
export function buildLocalOutline(
  chapters: LocalChapterRow[],
  placeholders: LocalPlaceholderRow[],
): OutlineCard[] {
  const ordered = [...chapters].sort((a, b) => a.order - b.order)

  // Chapter NUMBER is the running count of numbered chapters, so an unnumbered
  // chapter (a prologue) does not consume one. Same rule the canon walk uses,
  // and the reason outlineCardLabels renders "Prologue" rather than "Chapter 0".
  let numbered = 0
  const chapterCards: OutlineCard[] = ordered.map((ch, i) => {
    const number = ch.numbered ? ++numbered : (ch.title.trim().toLowerCase() === 'prologue' ? 0 : null)
    return {
      id: ch.id,
      book: '',
      chapter: number,
      position: i + 1,
      status: 'synced',
      heading: ch.title,
      pov: ch.pov ?? '',
      date: ch.date,
      writer_summary: ch.summary?.body ?? '',
      extracted_bullets: [],
      notes: null,
      loom_id: ch.id,
    }
  })

  const placeholderCards: OutlineCard[] = placeholders.map(p => ({
    id: `${PLACEHOLDER_PREFIX}${p.id}`,
    book: '',
    // No chapter behind it, so no number. outlineCardLabels continues the
    // sequence from the preceding written chapter, which is what a placeholder
    // should read as.
    chapter: null,
    position: p.position,
    status: 'planned',
    heading: p.heading,
    pov: p.pov,
    date: p.date,
    writer_summary: p.summary,
    extracted_bullets: [],
    notes: p.notes,
    loom_id: null,
  }))

  return [...chapterCards, ...placeholderCards].sort((a, b) => a.position - b.position)
}

/**
 * Where a new card goes when the writer asks for one "after position N".
 *
 * Halfway to the next occupied position, so repeated inserts at the same spot
 * keep their order instead of colliding. With nothing after it, a whole step.
 */
export function nextPlaceholderPosition(after: number, taken: number[]): number {
  const next = taken.filter(p => p > after).sort((a, b) => a - b)[0]
  return next === undefined ? after + 1 : (after + next) / 2
}
