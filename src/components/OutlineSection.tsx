'use client'

import Link from 'next/link'
import { LuCalendarDays, LuExternalLink, LuTriangleAlert } from 'react-icons/lu'
import { htmlToParagraphs, outlineCardLabels } from '@/lib/outlineCards'
import { useBookOutline, type BookOutline } from './editor/useBookOutline'

// The book page's Outline section (LOOM-96).
//
// The same cards WriteAI's plan pane shows, over the same store — a port
// against a shared spec rather than a shared component, because the two apps
// are on different React majors and the epic's contract is shared tokens and
// specs, not components, until Phase B.
//
// A BOARD, not a list. Cards sit in a grid three or four across, because the
// point of an outline is comparing chapters at a glance; one column of
// full-height cards is just the manuscript again, with fewer words. That is
// what widened the page from max-w-3xl.
//
// Read-only here. Editing, adding, reordering and deleting are LOOM-97.

function SyncBadge({ state }: { state: BookOutline['syncState'] }) {
  if (state === 'synced') return null

  // "behind" and "unknown" are different problems and get different words.
  // `unknown` in particular means WriteAI could not read Loom's manifest, so its
  // auto-reconcile is INERT — chapter numbering will not self-correct after
  // edits. WriteAI surfaces that deliberately rather than letting it be a
  // silent no-op, and hiding it here would undo that.
  const behind = state === 'behind'
  return (
    <span
      title={
        behind
          ? 'WriteAI has not ingested your latest chapters, so these cards may lag the manuscript.'
          : 'WriteAI cannot read this book’s manifest, so it cannot correct chapter numbering. Export the canon manuscript to restore it.'
      }
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        behind ? 'bg-amber-500/20 text-amber-400' : 'bg-choice-kill/15 text-choice-kill'
      }`}
    >
      <LuTriangleAlert size={10} />
      {behind ? 'Behind the manuscript' : 'Numbering not syncing'}
    </span>
  )
}

export default function OutlineSection({
  seriesId,
  bookId,
}: {
  seriesId: string
  bookId: string
}) {
  // Fetched here rather than in the page because the tab strip mounts only the
  // active section — so this runs exactly when the Outline tab is opened, and
  // never for a writer who only came for the cast. The endpoint behind it seeds
  // and saves on a GET, which makes "only when asked for" worth arranging.
  const { outline, reason, loading, onRetry } = useBookOutline(seriesId, bookId)

  if (loading && !outline) {
    return <p className="px-1 py-8 text-center text-sm text-ink-faint italic">Loading outline…</p>
  }

  if (!outline) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10 text-center">
        <p className="text-sm text-ink-faint italic">
          {reason === 'book-not-in-writeai'
            ? 'WriteAI hasn’t ingested this book yet, so it has no outline to show.'
            : 'WriteAI isn’t running, so the outline can’t be loaded. Nothing here is stored in Loom.'}
        </p>
        {reason !== 'book-not-in-writeai' && (
          <button onClick={onRetry} className="text-xs text-accent underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    )
  }

  if (outline.cards.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20 px-8 py-10">
        <p className="text-sm text-ink-faint italic text-center">
          No outline cards yet. Plan this book in WriteAI and its chapters will appear here.
        </p>
      </div>
    )
  }

  // Computed for the whole list at once, because a card's label depends on
  // every card before it — not on the card itself.
  const labels = outlineCardLabels(outline.cards)

  return (
    <div className="flex flex-col gap-3">
      {outline.syncState !== 'synced' && <SyncBadge state={outline.syncState} />}

      <div
        // auto-fill rather than a column count: the board reflows with the
        // window instead of committing to four columns and overflowing a
        // laptop. 250px is the width at which a summary is still readable.
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {outline.cards.map((card, i) => {
          const paragraphs = htmlToParagraphs(card.writer_summary)
          const planned = card.status === 'planned'
          // `loom_id` is the chapter's cuid, so the link needs no number-to-
          // chapter resolution and stays correct even when numbering drifts.
          const href = card.loom_id ? `/author/${seriesId}/chapter/${card.loom_id}` : null
          // A heading of "Chapter 1" beside a label of "Chapter 1" is the same
          // word twice. Show the heading only when the writer has actually named
          // the chapter something.
          const heading =
            card.heading && card.heading.trim().toLowerCase() !== labels[i].toLowerCase()
              ? card.heading
              : null

          return (
            <div
              key={card.id}
              className={`flex flex-col rounded-lg border px-3 py-2.5 ${
                planned
                  ? 'border-dashed border-accent/25 bg-surface-raised/50'
                  : 'border-accent/10 bg-surface-raised'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-ink">
                  {labels[i]}
                </span>
                {planned && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
                    Planned
                  </span>
                )}
                {/* An icon rather than the whole card: the card is something to
                    read, and making all of it a link means every glance is one
                    stray click from navigating away. */}
                {href && (
                  <Link
                    href={href}
                    title="Open this chapter in Loom"
                    aria-label={`Open ${labels[i]} in Loom`}
                    className="ml-auto shrink-0 text-ink-faint transition hover:text-accent"
                  >
                    <LuExternalLink size={12} />
                  </Link>
                )}
              </div>

              {heading && <p className="mt-1 truncate text-sm text-ink">{heading}</p>}

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-faint">
                {card.pov && <span className="truncate">{card.pov}</span>}
                {card.date && (
                  <span className="inline-flex items-center gap-1 italic">
                    <LuCalendarDays size={10} /> {card.date}
                  </span>
                )}
              </div>

              {paragraphs.length > 0 && (
                <p
                  // Clamped so the board stays a board. Cards of wildly
                  // different heights in a grid leave ragged holes, and the
                  // whole summary is a click away in the chapter itself.
                  className="mt-2 text-[11px] leading-relaxed text-ink-muted"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 8,
                    overflow: 'hidden',
                  }}
                >
                  {paragraphs.join(' ')}
                </p>
              )}

              {/* The extracted bullets are deliberately not on the card face.
                  They are per-chunk extraction detail — the same data the
                  chapter's Insights tab shows in full — and putting six of them
                  on every tile is what made the cards too tall to compare. */}
              {card.extracted_bullets.length > 0 && (
                <p className="mt-2 text-[10px] text-ink-faint/70">
                  {card.extracted_bullets.length} extracted event
                  {card.extracted_bullets.length === 1 ? '' : 's'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
