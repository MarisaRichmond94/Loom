'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  LuCalendarDays,
  LuExternalLink,
  LuGripVertical,
  LuPencil,
  LuPlus,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu'
import ConfirmDialog from './ConfirmDialog'
import OutlineCardModal from './editor/OutlineCardModal'
import { htmlToParagraphs, outlineCardLabels } from '@/lib/outlineCards'
import { useBookOutline, type BookOutline } from './editor/useBookOutline'
import type { OutlineCard } from '@/lib/writerOutline'

// The book page's Outline section (LOOM-96, editable in LOOM-97).
//
// The same cards WriteAI's plan pane shows, over the same store — a port
// against a shared spec rather than a shared component, because the two apps
// are on different React majors and the epic's contract is shared tokens and
// specs, not components, until Phase B.
//
// A BOARD, not a list. Cards sit in a grid three or more across, because the
// point of an outline is comparing chapters at a glance.
//
// ⚠️ Every content edit is a whole-list PUT — WriteAI has no per-card update —
// so the hook spreads changes over the existing card rather than rebuilding it,
// and trusts the response over local state. See useBookOutline.

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

function CardFace({
  card,
  label,
  seriesId,
  onEdit,
  onDelete,
  onInsertAfter,
  dragHandle,
}: {
  card: OutlineCard
  label: string
  seriesId: string
  onEdit: () => void
  onDelete: () => void
  onInsertAfter?: () => void
  dragHandle?: React.ReactNode
}) {
  const paragraphs = htmlToParagraphs(card.writer_summary)
  const planned = card.status === 'planned'
  // `loom_id` is the chapter's cuid, so the link needs no number-to-chapter
  // resolution and stays correct even when numbering drifts.
  const href = card.loom_id ? `/author/${seriesId}/chapter/${card.loom_id}` : null
  // A heading of "Chapter 1" beside a label of "Chapter 1" is the same word
  // twice. Show the heading only when the chapter is actually named something.
  const heading =
    card.heading && card.heading.trim().toLowerCase() !== label.toLowerCase() ? card.heading : null

  return (
    <div
      className={`group/card flex h-full flex-col rounded-lg border px-3 py-2.5 ${
        planned
          ? 'border-dashed border-accent/25 bg-surface-raised/50'
          : 'border-accent/10 bg-surface-raised'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {dragHandle}
        <span className="text-xs font-semibold uppercase tracking-widest text-ink">{label}</span>
        {planned && (
          <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
            Planned
          </span>
        )}

        {/* Controls fade in on hover: three permanent icons on every tile is
            more chrome than card, and this is meant to be read at a glance. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition group-hover/card:opacity-100 focus-within:opacity-100">
          {onInsertAfter && (
            <button
              onClick={onInsertAfter}
              title="Insert a planned card after this one"
              aria-label={`Insert a card after ${label}`}
              className="text-ink-faint transition hover:text-accent"
            >
              <LuPlus size={12} />
            </button>
          )}
          <button
            onClick={onEdit}
            title="Edit this card"
            aria-label={`Edit ${label}`}
            className="text-ink-faint transition hover:text-accent"
          >
            <LuPencil size={12} />
          </button>
          <button
            onClick={onDelete}
            title="Delete this card"
            aria-label={`Delete ${label}`}
            className="text-ink-faint transition hover:text-choice-kill"
          >
            <LuTrash2 size={12} />
          </button>
          {href && (
            <Link
              href={href}
              title="Open this chapter in Loom"
              aria-label={`Open ${label} in Loom`}
              className="text-ink-faint transition hover:text-accent"
            >
              <LuExternalLink size={12} />
            </Link>
          )}
        </div>
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
          // Clamped so the board stays a board. Cards of wildly different
          // heights leave ragged holes, and the whole summary is a click away.
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

      {/* The extracted bullets are deliberately not on the card face. They are
          per-chunk extraction detail — the same data the chapter's Insights tab
          shows in full — and six per tile made the cards too tall to compare. */}
      {card.extracted_bullets.length > 0 && (
        <p className="mt-2 text-[10px] text-ink-faint/70">
          {card.extracted_bullets.length} extracted event
          {card.extracted_bullets.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

function SortableCard(props: {
  card: OutlineCard
  label: string
  seriesId: string
  onEdit: () => void
  onDelete: () => void
  onInsertAfter: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <CardFace
        {...props}
        dragHandle={
          // A handle, not a draggable card: the card carries buttons and a
          // link, and making the whole tile a drag target means every click
          // starts a drag it has to decide not to be.
          <button
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            aria-label={`Reorder ${props.label}`}
            className="cursor-grab text-ink-faint/50 transition hover:text-ink-faint active:cursor-grabbing"
          >
            <LuGripVertical size={12} />
          </button>
        }
      />
    </div>
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
  const { outline, reason, loading, onRetry, saving, error, editCard, reorder, addCard, deleteCard } =
    useBookOutline(seriesId, bookId)

  const [editing, setEditing] = useState<{ card: OutlineCard; label: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ card: OutlineCard; label: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // A small distance before a drag starts, so clicking the handle is still a
  // click and a stray twitch does not reorder the book.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

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

  // Computed for the whole list at once, because a card's label depends on
  // every card before it — not on the card itself.
  const labels = outlineCardLabels(outline.cards)
  const labelFor = (id: string) => labels[outline.cards.findIndex(c => c.id === id)] ?? 'Card'

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over || active.id === over.id || !outline) return

    const ids = outline.cards.map(c => c.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    // Positions only. A written chapter's NUMBER belongs to the manuscript and
    // the backend re-derives it; reassigning it here is the bug that shifted
    // every card by one the moment a prologue was present.
    void reorder(arrayMove(ids, from, to))
  }

  /** Append after the last card. */
  function addAtEnd() {
    const last = outline?.cards.at(-1)?.position ?? 0
    void addCard(last + 1, 'New chapter')
  }

  /**
   * Insert after card `i`, at the midpoint between it and its neighbour.
   *
   * Fractional positions are the whole trick: a card lands between two others
   * without touching either, so nothing is renumbered and no written chapter's
   * number is disturbed. At the end of the list there is no neighbour to split
   * with, so it simply goes one past the last.
   */
  function insertAfter(i: number) {
    if (!outline) return
    const here = outline.cards[i].position
    const next = outline.cards[i + 1]?.position
    void addCard(next === undefined ? here + 1 : (here + next) / 2, 'New chapter')
  }

  const draggingCard = draggingId ? outline.cards.find(c => c.id === draggingId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {outline.syncState !== 'synced' && <SyncBadge state={outline.syncState} />}
        {saving && <span className="text-[10px] italic text-ink-faint">Saving…</span>}
        {error && <span className="text-[10px] text-choice-kill">{error}</span>}
        <button
          onClick={addAtEnd}
          disabled={saving}
          className="ml-auto flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          <LuPlus size={12} /> Add card
        </button>
      </div>

      {outline.cards.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20 px-8 py-10">
          <p className="text-center text-sm text-ink-faint italic">
            No outline cards yet. Add one, or plan this book in WriteAI.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <SortableContext items={outline.cards.map(c => c.id)} strategy={rectSortingStrategy}>
            <div
              // auto-fill rather than a column count: the board reflows with the
              // window instead of committing to four columns and overflowing a
              // laptop. 250px is the width at which a summary is still readable.
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: 12,
                alignItems: 'stretch',
              }}
            >
              {outline.cards.map((card, i) => (
                <SortableCard
                  key={card.id}
                  card={card}
                  label={labels[i]}
                  seriesId={seriesId}
                  onEdit={() => setEditing({ card, label: labels[i] })}
                  onDelete={() => setPendingDelete({ card, label: labels[i] })}
                  onInsertAfter={() => insertAfter(i)}
                />
              ))}
            </div>
          </SortableContext>

          {/* The dragged card follows the cursor at full opacity while its slot
              dims, so it is obvious what is moving and where it will land. */}
          <DragOverlay>
            {draggingCard && (
              <div className="w-[250px] opacity-90">
                <CardFace
                  card={draggingCard}
                  label={labelFor(draggingCard.id)}
                  seriesId={seriesId}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {editing && (
        <OutlineCardModal
          card={editing.card}
          label={editing.label}
          onSave={changes => editCard(editing.card.id, changes)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.label ?? 'this card'}?`}
        // The distinction that matters, spelled out because on screen the card
        // and the chapter look like one object: this removes the PLANNING card.
        // The manuscript is Loom's and WriteAI's outline store cannot touch it.
        message={
          pendingDelete?.card.status === 'synced'
            ? 'This removes the outline card only. The chapter itself, and everything you have written in it, stays exactly where it is.'
            : 'This planned card will be removed from the outline.'
        }
        onConfirm={() => {
          if (pendingDelete) void deleteCard(pendingDelete.card.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
