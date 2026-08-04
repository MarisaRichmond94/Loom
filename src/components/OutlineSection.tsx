'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
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
import { LuPlus, LuTriangleAlert } from 'react-icons/lu'
import ConfirmDialog from './ConfirmDialog'
import { useSectionActionSlot } from './SectionTabs'
import OutlineCard from './editor/OutlineCard'
import OutlineBoardSkeleton from './editor/OutlineBoardSkeleton'
import { outlineCardLabels } from '@/lib/outlineCards'
import { useBookOutline, type BookOutline } from './editor/useBookOutline'
import type { OutlineCard as Card } from '@/lib/writerOutline'

// The book page's Outline section (LOOM-96, editable in LOOM-97).
//
// The same board WriteAI's plan pane shows, over the same store — a port
// against a shared spec rather than a shared component, because the two apps
// are on different React majors and the epic's contract is shared tokens and
// specs, not components, until Phase B.
//
// ⚠️ Every content edit is a whole-list PUT — WriteAI has no per-card update —
// so the hook spreads changes over the existing card rather than rebuilding it,
// and trusts the response over local state. See useBookOutline.

/**
 * A drag sensor that refuses to start inside an interactive region.
 *
 * The whole card is the drag handle, which is what makes the board feel
 * physical — but the card is also full of inputs, and a text field you cannot
 * click into because the tile stole the pointer is worse than no dragging at
 * all. Anything marked `data-no-dnd="true"` (or inside something marked so)
 * blocks activation.
 *
 * Ported from WriteAI's NoDndPointerSensor for exactly this reason.
 */
class NoDndPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        let el: Element | null = nativeEvent.target as Element
        while (el) {
          if ((el as HTMLElement).dataset?.noDnd === 'true') return false
          el = el.parentElement
        }
        return true
      },
    },
  ]
}

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

function SortableOutlineCard(props: {
  card: Card
  label: string
  seriesId: string
  povSuggestions: string[]
  onSave: (changes: Partial<Card>) => void
  onDelete: () => void
  disabled: boolean
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: props.card.id,
  })

  return (
    <OutlineCard
      {...props}
      dragRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      dragStyle={{ transform: CSS.Transform.toString(transform), transition }}
      isDragging={isDragging}
    />
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

  const [pendingDelete, setPendingDelete] = useState<{ card: Card; label: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const actionSlot = useSectionActionSlot()

  // A little distance before a drag starts, so a click on the card is still a
  // click and a stray twitch does not reorder the book.
  const sensors = useSensors(useSensor(NoDndPointerSensor, { activationConstraint: { distance: 4 } }))

  // The board's own shape while it loads, not a line of text: the tab is
  // opened often, and a wait that already looks like the answer is a shorter
  // wait than one that reflows into it.
  if (loading && !outline) {
    return (
      <div className="animate-pulse">
        <OutlineBoardSkeleton />
      </div>
    )
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
  // Every POV already used in this book, for the chip's autocomplete. Sorted so
  // the list does not reshuffle as cards move.
  const povSuggestions = [...new Set(outline.cards.map(c => c.pov).filter(Boolean))].sort()

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

  /**
   * Insert after card `i`, at the midpoint between it and its neighbour.
   *
   * Fractional positions are the whole trick: a card lands between two others
   * without touching either, so nothing is renumbered and no written chapter's
   * number is disturbed. At the end there is no neighbour to split with, so it
   * goes one past the last.
   *
   * The card arrives with no date, unlike WriteAI's, which seeds it from the
   * card before. That is not an oversight: WriteAI inserts by rebuilding the
   * whole list client-side with an id it invents, while this goes through the
   * POST endpoint — one card, canonical `plan-…` id, no chance of losing the
   * book to a partial body. Seeding the date would cost a second write to buy
   * one click. The calendar is right there.
   */
  function insertAfter(i: number) {
    if (!outline) return
    const here = outline.cards[i]
    const next = outline.cards[i + 1]
    void addCard(next === undefined ? here.position + 1 : (here.position + next.position) / 2, '')
  }

  const draggingCard = draggingId ? outline.cards.find(c => c.id === draggingId) : null

  return (
    <div className="flex flex-col gap-3">
      {/* "Add card" belongs beside the tab labels, where "Add Character"
          already lives — same page, same kind of action, same place. It is
          portalled up rather than passed down because the handler needs the
          hook that lives in here. */}
      {actionSlot &&
        createPortal(
          <button
            onClick={() => addCard((outline.cards.at(-1)?.position ?? 0) + 1, '')}
            disabled={saving}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <LuPlus size={12} /> Add card
          </button>,
          actionSlot,
        )}

      {(outline.syncState !== 'synced' || saving || error) && (
        <div className="flex flex-wrap items-center gap-2">
          {outline.syncState !== 'synced' && <SyncBadge state={outline.syncState} />}
          {saving && <span className="text-[10px] italic text-ink-faint">Saving…</span>}
          {error && <span className="text-[10px] text-choice-kill">{error}</span>}
        </div>
      )}

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
              // auto-fill rather than a fixed column count: the board reflows
              // with the window instead of overflowing a laptop.
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {outline.cards.map((card, i) => (
                // The insert affordance lives on the gap between cards, not on
                // the card: "add one after this" is about the seam, and a
                // button floating in the seam is where the eye already is.
                <div key={card.id} className="group/insert relative">
                  <SortableOutlineCard
                    card={card}
                    label={labels[i]}
                    seriesId={seriesId}
                    povSuggestions={povSuggestions}
                    onSave={changes => void editCard(card.id, changes)}
                    onDelete={() => setPendingDelete({ card, label: labels[i] })}
                    disabled={saving}
                  />
                  <button
                    data-no-dnd="true"
                    onClick={() => insertAfter(i)}
                    disabled={saving}
                    title="Insert a card here"
                    aria-label={`Insert a card after ${labels[i]}`}
                    className="absolute right-0 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-accent opacity-0 shadow-md transition-opacity hover:bg-accent/80 group-hover/insert:opacity-100 disabled:opacity-0"
                  >
                    <LuPlus size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          </SortableContext>

          {/* The dragged card follows the cursor at full opacity while its slot
              dims, so it is obvious what is moving and where it will land. */}
          <DragOverlay>
            {draggingCard && (
              <div className="w-[260px] opacity-90">
                <OutlineCard
                  card={draggingCard}
                  label={labels[outline.cards.findIndex(c => c.id === draggingCard.id)] ?? ''}
                  seriesId={seriesId}
                  povSuggestions={povSuggestions}
                  onSave={() => {}}
                  onDelete={() => {}}
                  disabled
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
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
