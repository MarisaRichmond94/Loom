'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LuExternalLink, LuGitBranch } from 'react-icons/lu'
import { useBookChapterTags } from './useBookChapterTags'
import TagFilterSelect, { type FilterOption } from './TagFilterSelect'
import EditableSummary from './EditableSummary'
import { useTimelineData } from '@/components/timeline/useTimelineData'
import { prefetchBookOutline } from '@/components/editor/outlineCache'
import { htmlToParagraphs } from '@/lib/outlineCards'
import { matchGaps, type BookChapterRow } from '@/lib/bookChapterTags'
import type { OutlineCard } from '@/lib/writerOutline'

// The book page's Chapters tab (LOOM-120/121).
//
// "I want to add a chapter with Chase, but I need to see every chapter Chase is
// already in" — and, crucially, the SPACING between those chapters. That is why
// this is a sequence and not a list: non-matching chapters stay in place,
// collapsed, so a nine-chapter absence is visible as nine chapters rather than
// inferred from two numbers that happen to be far apart.
//
// ⚠️ Why this is not the Outline tab, recorded here because it looks like it
// should be: the outline is WriteAI's store and holds canon only. Branch-gated
// chapters ("Bonus Chapter 1") never reach the canon manifest, so they never get
// an outline card — 343 Loom chapters, 334 cards when this shipped, the 9
// missing being exactly the bonus chapters. Worse, a card added for one is
// PRUNED by WriteAI's `_auto_reconcile`, which drops any card whose `loom_id` is
// absent from the manifest. So the sequence comes from Loom and the summaries
// are joined ON to it, read-only, one direction only. Nothing here writes.
//
// The two filters are AND-ed, and there is no character/event mode switch. A
// switch was the first shape and it was one control too many: it had to clear
// the selection on every flip (a character id means nothing in event mode), so
// it spent its existence undoing the user's last action. Two independent
// fields cost the same space, never fight each other, and answer "which
// chapters have Chase AND the heist" for free.

/** Summaries keyed by Loom chapter id, joined from the outline read-only. */
type SummaryMap = Record<string, { text: string; source: 'writer' | 'machine' }>

function buildSummaries(cards: OutlineCard[]): SummaryMap {
  const out: SummaryMap = {}
  for (const card of cards) {
    if (!card.loom_id) continue
    // `writer_summary` is HTML on every card in the live store. Rendered as
    // TEXT, never injected — this view is read-only and dangerouslySetInnerHTML
    // on a string from another process buys nothing here.
    const paragraphs = htmlToParagraphs(card.writer_summary)
    const text = paragraphs.join(' ')
    if (text) {
      // `summary_source` records what the machine last wrote. A writer_summary
      // that still matches it is machine text; anything else the writer touched.
      const machine = (card.summary_source ?? '').trim().length > 0
        && htmlToParagraphs(card.summary_source).join(' ') === text
      out[card.loom_id] = { text, source: machine ? 'machine' : 'writer' }
      continue
    }
    const bullets = (card.extracted_bullets ?? []).filter(Boolean)
    if (bullets.length) out[card.loom_id] = { text: bullets.join(' • '), source: 'machine' }
  }
  return out
}

/**
 * Every card is the SAME height, and its body scrolls.
 *
 * A grid of cards that each size to their summary reflows into a ragged mess —
 * and worse for this view, row heights then encode summary length rather than
 * anything about the story, which is noise laid over exactly the spatial signal
 * the tab exists to show.
 */
const CARD_HEIGHT = 190
const GRID_GAP = 12
/**
 * The board scrolls at three and a half rows.
 *
 * The half is the point: a row cut through the middle is what tells you there
 * is more below, where a whole number of rows reads as the end of the list.
 */
const BOARD_HEIGHT = 3.5 * (CARD_HEIGHT + GRID_GAP)

function ChapterCard({
  row,
  summary,
  seriesId,
  matched,
  filtering,
  gap,
  isFirstMatch,
  onSummarySaved,
}: {
  row: BookChapterRow
  summary: SummaryMap[string] | undefined
  seriesId: string
  matched: boolean
  filtering: boolean
  /** Non-matching chapters immediately before this one. Only meaningful on a
   *  match, and only while filtering. */
  gap: number
  isFirstMatch: boolean
  onSummarySaved: (chapterId: string, body: string) => void
}) {
  // Faded, never resized and never re-flowed. Two earlier versions got this
  // wrong: one collapsed non-matching cards to a thin strip, and one drew the
  // run-length as a full-width rule BETWEEN cards — which, in a grid, is a
  // row-spanning item that forces a line break wherever it lands, so filtering
  // visibly rearranged the board. The gap is now a label inside the matching
  // card, and filtering changes nothing but colour.
  const faded = filtering && !matched

  return (
    <div
      style={{ height: CARD_HEIGHT }}
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface-raised px-3.5 py-3 transition-[opacity,border-color] ${
        row.offCanon ? 'border-dashed border-amber-500/40' : 'border-accent/10'
      } ${matched && filtering ? 'ring-1 ring-accent/40' : ''} ${
        // A faded card is inert: no hover lift, no border change, no revealed
        // controls. Reacting to the pointer is what makes a de-emphasised card
        // read as an active one.
        faded
          ? 'opacity-40'
          : row.offCanon
            ? 'hover:border-amber-500/60'
            : 'hover:border-accent/25'
      }`}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          {/* The AUTHORED title, verbatim — the same string the left-hand
              sidebar shows. A branch chapter reads "Bonus Chapter 1", which no
              canon numbering would ever produce for it. */}
          <span className="truncate text-xs font-medium text-ink">{row.title}</span>
          {row.offCanon && (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
              <LuGitBranch size={10} /> Branch only
            </span>
          )}
        </div>
        <Link
          href={`/author/${seriesId}/chapter/${row.chapterId}`}
          title="Open this chapter"
          aria-label={`Open ${row.title}`}
          className={`shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition focus-visible:opacity-100 ${
            faded ? '' : 'hover:text-accent group-hover:opacity-100'
          }`}
        >
          <LuExternalLink size={12} />
        </Link>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {row.offCanon ? (
          // Editable in place — this chapter has no outline card and can never
          // get one, so Loom is the only place its summary can live.
          <EditableSummary
            chapterId={row.chapterId}
            initial={row.manualSummary ?? ''}
            onSaved={body => onSummarySaved(row.chapterId, body)}
          />
        ) : (
          // Read-only: this text is WriteAI's, joined one direction only.
          <p className="min-h-0 flex-1 overflow-y-auto text-[11px] leading-relaxed text-ink-faint">
            {summary?.text ?? <span className="italic">No summary yet.</span>}
          </p>
        )}
      </div>

      {/* The run length, in the card rather than between cards. Fixed height,
          so showing it cannot reflow anything. */}
      {filtering && matched && gap > 0 && (
        <span className="shrink-0 truncate pt-1 text-[9px] italic text-ink-faint">
          {gap} chapter{gap === 1 ? '' : 's'} {isFirstMatch ? 'before this' : 'since the last'}
        </span>
      )}
    </div>
  )
}

export default function ChaptersSection({ seriesId, bookId }: { seriesId: string; bookId: string }) {
  const { chapters, loading, failed, refresh, applyManualSummary } = useBookChapterTags(seriesId, bookId)
  // Shared with the Timeline tab through its cache, so opening this tab costs
  // no extra WriteAI request when Timeline has already been opened (and warms
  // it when it has not).
  const { events, characterPool, unreachable } = useTimelineData()

  const [characterId, setCharacterId] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)

  // Summaries, joined read-only from the outline the Outline tab already
  // fetched. Through the shared cache, so this does not add a second
  // seed-and-save GET on WriteAI's side.
  const [summaries, setSummaries] = useState<SummaryMap>({})
  useEffect(() => {
    let live = true
    void prefetchBookOutline(seriesId, bookId).then(({ outline }) => {
      if (live) setSummaries(outline ? buildSummaries(outline.cards) : {})
    })
    return () => {
      live = false
    }
  }, [seriesId, bookId])

  // Only entities actually tagged somewhere in this book. Offering the full
  // cast would fill the list with names whose every selection returns nothing.
  const characterOptions: FilterOption[] = useMemo(() => {
    const tagged = new Set(chapters.flatMap(c => c.characters).map(e => e.id))
    return characterPool
      .filter(c => tagged.has(c.id))
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [chapters, characterPool])

  const eventOptions: FilterOption[] = useMemo(() => {
    const tagged = new Set(chapters.flatMap(c => c.events).map(e => e.id))
    return events
      .filter(e => tagged.has(e.id))
      .map(e => ({ id: e.id, name: e.title }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [chapters, events])

  const filtering = characterId !== null || eventId !== null
  // AND, not OR: two filters set means "chapters that have both". OR would
  // make adding a second filter widen the result, which is the opposite of
  // what setting a filter is for.
  const matches = useMemo(
    () => (row: BookChapterRow) =>
      (characterId === null || row.characters.some(c => c.id === characterId)) &&
      (eventId === null || row.events.some(e => e.id === eventId)),
    [characterId, eventId],
  )

  const gaps = useMemo(
    () => (filtering ? matchGaps(chapters, matches) : []),
    [chapters, matches, filtering],
  )
  const matchCount = gaps.length

  if (loading && chapters.length === 0) {
    return (
      <div className="grid animate-pulse gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[150px] rounded-lg border border-accent/10 bg-surface-raised/50" />
        ))}
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10 text-center">
        <p className="text-sm italic text-ink-faint">This book’s chapters couldn’t be loaded.</p>
        <button onClick={() => void refresh()} className="text-xs text-accent underline underline-offset-2">
          Try again
        </button>
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20 px-8 py-10">
        <p className="px-8 text-center text-sm italic text-ink-faint">
          No chapters in this book yet.
        </p>
      </div>
    )
  }

  // Index of each match, so a gap rule can be placed before the right card.
  const matchIndexByChapterId = new Map<string, number>()
  if (filtering) {
    let i = 0
    for (const row of chapters) if (matches(row)) matchIndexByChapterId.set(row.chapterId, i++)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <TagFilterSelect
          label="Character"
          placeholder="Any character"
          options={characterOptions}
          value={characterId}
          onChange={setCharacterId}
          emptyHint="No characters tagged in this book yet."
        />
        <TagFilterSelect
          label="Event"
          placeholder="Any event"
          options={eventOptions}
          value={eventId}
          onChange={setEventId}
          emptyHint="No events tagged in this book yet."
        />

        {filtering && (
          <span className="pb-2.5 text-[11px] text-ink-faint">
            {matchCount} of {chapters.length} chapters
          </span>
        )}
      </div>

      {unreachable && (
        <p className="text-[10px] italic text-ink-faint">
          WriteAI isn’t reachable, so names and summaries are unavailable. The chapter sequence below
          is Loom’s and is complete.
        </p>
      )}

      {/* Scrolls at three and a half rows, so the board never pushes the rest
          of the page off screen on a 90-chapter book. `pr` leaves room for the
          scrollbar so it does not sit on top of the last column. */}
      <div className="overflow-y-auto pr-1" style={{ maxHeight: BOARD_HEIGHT }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: GRID_GAP,
            alignItems: 'start',
          }}
        >
          {/* One grid item per chapter, always — no wrappers, no row-spanning
              rules. That is what keeps the layout identical whether or not a
              filter is set. */}
          {chapters.map(row => {
            const matched = matches(row)
            const idx = matchIndexByChapterId.get(row.chapterId)
            return (
              <ChapterCard
                key={row.chapterId}
                row={row}
                summary={summaries[row.chapterId]}
                seriesId={seriesId}
                matched={matched}
                filtering={filtering}
                gap={idx === undefined ? 0 : gaps[idx]}
                isFirstMatch={idx === 0}
                onSummarySaved={applyManualSummary}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
