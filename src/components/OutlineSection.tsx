'use client'

import Link from 'next/link'
import { LuCalendarDays, LuTriangleAlert, LuUser } from 'react-icons/lu'
import { htmlToParagraphs, outlineCardLabels } from '@/lib/outlineCards'
import { useBookOutline, type BookOutline } from './editor/useBookOutline'

// The book page's Outline section (LOOM-96).
//
// The same cards WriteAI's plan pane shows, over the same store — a port
// against a shared spec rather than a shared component, because the two apps
// are on different React majors and the epic's contract is shared tokens and
// specs, not components, until Phase B.
//
// Read-only here. Editing, adding, reordering and deleting are LOOM-97.
//
// The one thing this copy does that WriteAI's cannot: a written chapter's card
// links straight to the chapter in Loom. That is most of the reason to have the
// outline on this page at all.

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
    <div className="flex flex-col gap-2">
      {outline.syncState !== 'synced' && (
        <div className="mb-1">
          <SyncBadge state={outline.syncState} />
        </div>
      )}

      {outline.cards.map((card, i) => {
        const paragraphs = htmlToParagraphs(card.writer_summary)
        const planned = card.status === 'planned'
        // `loom_id` is the chapter's cuid, so a written card links straight to
        // the chapter — no number-to-chapter resolution, and correct even for a
        // book whose numbering has drifted.
        const href = card.loom_id ? `/author/${seriesId}/chapter/${card.loom_id}` : null

        const body = (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-widest text-ink-faint">
                {labels[i]}
              </span>
              <span className="text-sm text-ink">{card.heading || '(untitled)'}</span>
              {planned && (
                <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
                  Planned
                </span>
              )}
            </div>

            {(card.pov || card.date) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {card.pov && (
                  <span className="inline-flex items-center gap-1">
                    <LuUser size={11} /> {card.pov}
                  </span>
                )}
                {card.date && (
                  <span className="inline-flex items-center gap-1 italic">
                    <LuCalendarDays size={11} /> {card.date}
                  </span>
                )}
              </div>
            )}

            {paragraphs.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {paragraphs.map((p, n) => (
                  <p key={n} className="text-xs leading-relaxed text-ink-muted">
                    {p}
                  </p>
                ))}
              </div>
            )}

            {card.extracted_bullets.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 border-t border-accent/10 pt-2">
                {card.extracted_bullets.map((b, n) => (
                  <li key={n} className="flex gap-2 text-[11px] leading-relaxed text-ink-faint">
                    <span className="mt-[0.5em] size-1 shrink-0 rounded-full bg-accent/40" />
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {card.notes && (
              <p className="mt-2 border-t border-accent/10 pt-2 text-[11px] italic leading-relaxed text-ink-faint">
                {card.notes}
              </p>
            )}
          </>
        )

        const shell = `rounded-lg border px-4 py-3 transition ${
          planned
            ? 'border-dashed border-accent/25 bg-surface-raised/50'
            : 'border-accent/10 bg-surface-raised'
        }`

        // A planned card has no chapter to open, so it is not a link. Dressing
        // it as one and doing nothing on click is worse than plain text.
        return href ? (
          <Link key={card.id} href={href} className={`${shell} block hover:border-accent/40`}>
            {body}
          </Link>
        ) : (
          <div key={card.id} className={shell}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
