'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { LuPlus, LuRefreshCw } from 'react-icons/lu'
import ConfirmDialog from './ConfirmDialog'
import DeleteChapterDialog from './DeleteChapterDialog'
import { useSectionActionSlot } from './SectionTabs'
import OutlineBoardSkeleton from './editor/OutlineBoardSkeleton'
import OutlineStalenessBanner from './editor/OutlineStalenessBanner'
import { invalidateOutlineCache, prefetchBookOutline, type OutlineResult } from './editor/outlineCache'
import { useCanonSave } from './editor/useCanonSave'
import ChapterOutlineCard, { type KindToggle } from './outline/ChapterOutlineCard'
import SyncSummariesDialog, { type SyncCandidate } from './outline/SyncSummariesDialog'
import { useBookChapterTags } from './chapters/useBookChapterTags'
import { useTimelineData } from './timeline/useTimelineData'
import TagFilterSelect, { ClearFiltersButton, type FilterOption } from './chapters/TagFilterSelect'
import { useAuthor } from '@/lib/authorContext'
import { matchGaps, type BookChapterRow } from '@/lib/bookChapterTags'
import { buildAiSummaries, resolveSummary, type AiSummary, type ResolvedSummary } from '@/lib/outlineSummaries'
import {
  clampDropIndex,
  isEpilogueTitle,
  isPinnedChapter,
  isPrologueTitle,
  nextChapterTitle,
  renumberAfterDrag,
} from '@/lib/chapterNumbering'

// The book page's Outline tab — one board over the book's REAL chapters.
//
// This replaced two tabs. The old Outline tab was a proxy over WriteAI's
// `plan_outline.json`, so a book WriteAI had never ingested (a new book, or one
// deliberately kept out of ~/Writing) had no board at all, and moving or
// deleting its cards never touched the manuscript. The Chapters tab had Loom's
// real sequence but was read-only. Here every card IS a Loom chapter:
//
//   add       → a blank chapter, titled "Chapter N"; later chapters renumber
//   drag      → moves the chapter; "Chapter N" titles renumber
//   delete    → deletes the chapter (the chapter page's own confirmation)
//   prologue / epilogue → the first / last card's hover toggle
//   POV, date → the chapter's own columns
//   summary   → the writer's ChapterSummary, which ALWAYS wins over WriteAI's
//
// WriteAI is read here and never written: its generated summaries are joined
// on (badged "AI generated") wherever the writer has not written one, and Sync
// switches a card back to WriteAI's text. With WriteAI down or the book never
// ingested, the board still works completely — only the AI summaries are absent.
//
// Every structural change is followed by the same steps the sidebar takes:
// re-read the rows, reload the sidebar's series, and the canon save (which,
// with autosave on, re-exports the manuscript so WriteAI's numbering follows —
// and for a book with no ~/Writing folder, simply does nothing).

/**
 * A drag sensor that refuses to start inside an interactive region.
 *
 * The whole card is the drag handle, which is what makes the board feel
 * physical — but the card is also full of inputs, and a text field you cannot
 * click into because the tile stole the pointer is worse than no dragging at
 * all. Anything marked `data-no-dnd="true"` (or inside something marked so)
 * blocks activation. Ported from WriteAI's NoDndPointerSensor.
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

type CardProps = React.ComponentProps<typeof ChapterOutlineCard>

function SortableCard(props: CardProps & { sortDisabled: boolean }) {
  const { sortDisabled, ...card } = props
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.chapterId,
    disabled: sortDisabled,
  })
  return (
    <ChapterOutlineCard
      {...card}
      draggable={!sortDisabled}
      dragRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      dragStyle={{ transform: CSS.Transform.toString(transform), transition }}
      isDragging={isDragging}
    />
  )
}

/** The hover toggle each end of the book offers, or null. */
function kindToggleFor(rows: BookChapterRow[], index: number): KindToggle | null {
  const row = rows[index]
  if (index === 0) {
    return isPrologueTitle(row.title)
      ? { kind: 'chapter', label: 'Turn the prologue back into Chapter 1' }
      : { kind: 'prologue', label: 'Make this the prologue' }
  }
  if (index === rows.length - 1) {
    return isEpilogueTitle(row.title)
      ? { kind: 'chapter', label: 'Turn the epilogue back into a numbered chapter' }
      : { kind: 'epilogue', label: 'Make this the epilogue' }
  }
  return null
}

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null)
  return (data as { error?: string } | null)?.error ?? `request failed (${res.status})`
}

export default function OutlineSection({ seriesId, bookId }: { seriesId: string; bookId: string }) {
  const { chapters: rows, loading, failed, refresh, applyManualSummary, replaceLocal } =
    useBookChapterTags(seriesId, bookId)
  const { loadSeries } = useAuthor()
  const { saveCanonAfterStructuralChange } = useCanonSave(seriesId)
  // Shared with the Timeline tab through its cache, for the filters' names.
  const { events, characterPool } = useTimelineData()
  const actionSlot = useSectionActionSlot()

  // ── WriteAI's summaries, read-only ────────────────────────────────────────
  // Through the shared outline cache, so the page's idle prefetch and this
  // mount land on one request. That GET is not a pure read on WriteAI's side
  // (it seeds/reconciles its own store) — the same request the old Outline tab
  // made on every open, nothing new.
  const [outlineResult, setOutlineResult] = useState<OutlineResult | null>(null)
  const loadOutline = useCallback(
    (fresh = false) => {
      if (fresh) invalidateOutlineCache(seriesId, bookId)
      let live = true
      void prefetchBookOutline(seriesId, bookId).then(r => {
        if (live) setOutlineResult(r)
      })
      return () => {
        live = false
      }
    },
    [seriesId, bookId],
  )
  useEffect(() => loadOutline(), [loadOutline])
  const ai: Record<string, AiSummary> = useMemo(
    () => (outlineResult?.outline ? buildAiSummaries(outlineResult.outline.cards) : {}),
    [outlineResult],
  )
  const aiAvailable = Object.values(ai).some(a => a.aiHtml !== null)

  const summaries: Record<string, ResolvedSummary> = useMemo(() => {
    const out: Record<string, ResolvedSummary> = {}
    for (const row of rows) out[row.chapterId] = resolveSummary(row.manualSummary, ai[row.chapterId])
    return out
  }, [rows, ai])

  // ── Filters (carried over from the Chapters tab) ──────────────────────────
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [pov, setPov] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const filtering = characterIds.length > 0 || pov !== null || eventId !== null

  // Only entities actually tagged somewhere in this book — offering the full
  // cast would fill the list with names whose every selection returns nothing.
  const characterOptions: FilterOption[] = useMemo(() => {
    const tagged = new Set(rows.flatMap(c => c.characters).map(e => e.id))
    return characterPool
      .filter(c => tagged.has(c.id))
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, characterPool])
  const eventOptions: FilterOption[] = useMemo(() => {
    const tagged = new Set(rows.flatMap(c => c.events).map(e => e.id))
    return events
      .filter(e => tagged.has(e.id))
      .map(e => ({ id: e.id, name: e.title }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, events])
  // Every POV already used in this book — the filter's options and the chip's
  // autocomplete. Sorted so the list does not reshuffle as chapters move.
  const povSuggestions = useMemo(
    () => [...new Set(rows.map(r => r.pov).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const povOptions: FilterOption[] = povSuggestions.map(p => ({ id: p, name: p }))

  // AND, not OR — across fields and within the character field alike. Adding
  // a name must never widen the result.
  const matches = useCallback(
    (row: BookChapterRow) =>
      characterIds.every(id => row.characters.some(c => c.id === id)) &&
      (pov === null || row.pov === pov) &&
      (eventId === null || row.events.some(e => e.id === eventId)),
    [characterIds, pov, eventId],
  )
  const gaps = useMemo(() => (filtering ? matchGaps(rows, matches) : []), [rows, matches, filtering])

  // ── Board state ───────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BookChapterRow | null>(null)
  const [pendingSync, setPendingSync] = useState<BookChapterRow | null>(null)
  const [bulkSyncOpen, setBulkSyncOpen] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)

  // Clicking outside the board hands the wheel back from the active card.
  useEffect(() => {
    if (activeId === null) return
    function onDown(e: MouseEvent) {
      if (!boardRef.current?.contains(e.target as Node)) setActiveId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [activeId])

  // A little distance before a drag starts, so a click on the card is still a
  // click and a stray twitch does not reorder the book.
  const sensors = useSensors(useSensor(NoDndPointerSensor, { activationConstraint: { distance: 4 } }))

  /** Run one structural change, then bring every view of the book back in line. */
  const structural = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await work()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      } finally {
        // Re-read even after a failure: the truth is the database, and a
        // half-believed optimistic state is worse than a refetch.
        await Promise.all([refresh(), loadSeries()])
        void saveCanonAfterStructuralChange(bookId)
        setBusy(false)
      }
    },
    [refresh, loadSeries, saveCanonAfterStructuralChange, bookId],
  )

  /** Insert a blank chapter so it lands at `index` in the current sequence. */
  function insertAt(index: number) {
    const title = nextChapterTitle(rows, index)
    // Always an explicit position. The route's append path numbers by row
    // COUNT, which collides with an existing `order` the moment the book's
    // orders have a gap; an explicit insert shifts what is there instead.
    const atOrder = index < rows.length ? rows[index].order : (rows.at(-1)?.order ?? 0) + 1
    void structural(async () => {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, insertAtOrder: atOrder }),
      })
      if (!res.ok) throw new Error(`Couldn’t add the chapter: ${await readError(res)}`)
      const created = (await res.json()) as { id?: string }
      if (created.id) setActiveId(created.id)
    })
  }

  /** Where "Add chapter" puts one: the end, or just before the Epilogue. */
  const appendIndex =
    rows.length > 0 && isEpilogueTitle(rows[rows.length - 1].title) ? rows.length - 1 : rows.length

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = rows.findIndex(r => r.chapterId === active.id)
    const overIndex = rows.findIndex(r => r.chapterId === over.id)
    if (from < 0 || overIndex < 0) return
    const to = clampDropIndex(rows, overIndex)
    if (to === from) return

    // Same two steps as the sidebar: positional order first, then renumber only
    // the chapters sharing the moved one's prefix ("Chapter N").
    const movedTitle = rows[from].title
    const moved = arrayMove(rows, from, to).map((r, i) => ({ ...r, order: i + 1 }))
    const renumbered = renumberAfterDrag(moved, movedTitle)
    replaceLocal(renumbered)
    void structural(async () => {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renumbered.map(r => ({ id: r.chapterId, order: r.order, title: r.title }))),
      })
      if (!res.ok) throw new Error(`Couldn’t move the chapter: ${await readError(res)}`)
    })
  }

  function toggleKind(row: BookChapterRow, toggle: KindToggle) {
    void structural(async () => {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters/${row.chapterId}/kind`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: toggle.kind }),
      })
      if (!res.ok) throw new Error(`Couldn’t change ${row.title}: ${await readError(res)}`)
    })
  }

  function deleteChapter(row: BookChapterRow) {
    setPendingDelete(null)
    if (activeId === row.chapterId) setActiveId(null)
    void structural(async () => {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters/${row.chapterId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Couldn’t delete ${row.title}: ${await readError(res)}`)
    })
  }

  /** POV/date are the manuscript's header lines, so they re-export too. */
  async function saveMeta(row: BookChapterRow, data: { pov?: string; date?: string | null }) {
    setError(null)
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters/${row.chapterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      setError(`Couldn’t save ${row.title}: ${await readError(res)}`)
      return
    }
    replaceLocal(rows.map(r => (r.chapterId === row.chapterId ? { ...r, ...data } : r)))
    void saveCanonAfterStructuralChange(bookId)
  }

  async function saveSummary(row: BookChapterRow, html: string) {
    setError(null)
    const res = await fetch(`/api/chapters/${row.chapterId}/summary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: html }),
    })
    if (!res.ok) {
      setError(`Couldn’t save the summary for ${row.title}: ${await readError(res)}`)
      return
    }
    applyManualSummary(row.chapterId, html)
  }

  async function syncToAi(chapterIds: string[]) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapter-summaries/use-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIds }),
      })
      if (!res.ok) {
        setError(`Couldn’t sync: ${await readError(res)} — no summaries were changed.`)
        return
      }
      for (const id of chapterIds) applyManualSummary(id, '')
    } catch {
      setError('Couldn’t sync — no summaries were changed.')
    } finally {
      setBusy(false)
    }
  }

  const syncCandidates: SyncCandidate[] = rows.flatMap(row => {
    const s = summaries[row.chapterId]
    const aiHtml = ai[row.chapterId]?.aiHtml
    return s?.canSync && aiHtml ? [{ chapterId: row.chapterId, title: row.title, mineHtml: s.html, aiHtml }] : []
  })

  // ── Render ────────────────────────────────────────────────────────────────
  // Beside the tab labels, where "Add Character" already lives — same page,
  // same kind of action, same place. Portalled up because the handlers need
  // the state in here.
  const headerActions =
    actionSlot &&
    createPortal(
      <div className="flex items-center gap-2">
        {/* A ghost icon, like the Characters tab's refresh: a secondary action
            beside the primary one. The tooltip carries the detail. */}
        <button
          onClick={() => setBulkSyncOpen(true)}
          disabled={busy || rows.length === 0}
          title="Sync summaries — replace summaries you wrote with WriteAI’s AI-generated ones. You choose which chapters."
          aria-label="Sync summaries"
          className="flex items-center rounded px-2 py-1.5 text-xs text-ink-faint transition hover:text-ink disabled:opacity-50"
        >
          <LuRefreshCw size={13} />
        </button>
        <button
          onClick={() => insertAt(appendIndex)}
          disabled={busy || loading}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          <LuPlus size={12} /> Add Chapter
        </button>
      </div>,
      actionSlot,
    )

  if (loading && rows.length === 0) {
    return (
      <div className="animate-pulse">
        <OutlineBoardSkeleton />
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

  const draggingRow = draggingId ? rows.find(r => r.chapterId === draggingId) : null
  const matchIndex = new Map<string, number>()
  if (filtering) {
    let i = 0
    for (const row of rows) if (matches(row)) matchIndex.set(row.chapterId, i++)
  }

  return (
    // px/pb because the tab's scroller has no padding of its own and a card's
    // selection ring is a box-shadow — at the edges it was simply clipped. The
    // insert "+" straddles the seam between cards, so it needs the room too.
    // flex-1: SectionTabs' fillHeight wrapper is a flex column, so this fills
    // the tab's remaining height — which is what lets the empty state below
    // reach the bottom of the page instead of sitting in a short box.
    <div className="flex flex-1 flex-col gap-3 px-2.5 pb-2.5">
      {headerActions}

      {/* Sticky to the tab's scroller; -mx/px so its opaque background reaches
          the scroller's real edges while cards scroll under it. */}
      <div className="sticky top-0 z-10 -mx-2.5 flex flex-wrap items-end gap-3 bg-surface-base px-2.5 pb-1">
        <TagFilterSelect
          multiple
          label="Character"
          placeholder="Any character"
          options={characterOptions}
          value={characterIds}
          onChange={setCharacterIds}
          emptyHint="No characters tagged in this book yet."
          disabled={characterOptions.length === 0}
        />
        <TagFilterSelect
          label="POV"
          placeholder="Any POV"
          options={povOptions}
          value={pov}
          onChange={setPov}
          emptyHint="No chapter in this book has a POV yet."
          disabled={povOptions.length === 0}
        />
        <TagFilterSelect
          label="Event"
          placeholder="Any event"
          options={eventOptions}
          value={eventId}
          onChange={setEventId}
          emptyHint="No events tagged in this book yet."
          disabled={eventOptions.length === 0}
        />
        <ClearFiltersButton
          disabled={!filtering}
          onClick={() => { setCharacterIds([]); setPov(null); setEventId(null) }}
        />
        {filtering && (
          <span className="ml-auto pb-2.5 text-[11px] text-ink-faint">
            {gaps.length} of {rows.length} chapter(s) · dragging is off while filtering
          </span>
        )}
      </div>

      {outlineResult?.outline && outlineResult.outline.syncState !== 'synced' && (
        <OutlineStalenessBanner
          seriesId={seriesId}
          bookId={bookId}
          writeaiNumber={outlineResult.outline.writeaiNumber}
          syncState={outlineResult.outline.syncState}
          onSynced={() => loadOutline(true)}
        />
      )}
      {outlineResult?.reason === 'writeai-unavailable' && (
        <p className="text-[10px] italic text-ink-faint">
          WriteAI isn’t reachable, so AI-generated summaries aren’t shown. Everything else here is Loom’s and works as normal.
        </p>
      )}

      {(busy || error) && (
        <div className="flex flex-wrap items-center gap-2">
          {busy && <span className="text-[10px] italic text-ink-faint">Saving…</span>}
          {error && <span role="alert" className="text-[10px] text-choice-kill">{error}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10">
          <p className="text-center text-sm italic text-ink-faint">
            No chapters yet. Click the Add Chapter button to start outlining.
          </p>
          <button
            onClick={() => insertAt(0)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <LuPlus size={12} /> Add Chapter
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <SortableContext items={rows.map(r => r.chapterId)} strategy={rectSortingStrategy}>
            <div
              ref={boardRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {rows.map((row, i) => {
                const matched = filtering && matches(row)
                const idx = matchIndex.get(row.chapterId)
                const gap = idx === undefined ? 0 : gaps[idx]
                const toggle = kindToggleFor(rows, i)
                const isEpilogue = i === rows.length - 1 && isEpilogueTitle(row.title)
                return (
                  // The insert affordance lives on the seam between cards:
                  // "add one after this" is about the gap, not the card.
                  <div key={row.chapterId} className="group/insert relative">
                    <SortableCard
                      chapterId={row.chapterId}
                      title={row.title}
                      seriesId={seriesId}
                      pov={row.pov}
                      date={row.date}
                      summary={summaries[row.chapterId]}
                      povSuggestions={povSuggestions}
                      onSavePov={p => void saveMeta(row, { pov: p })}
                      onSaveDate={d => void saveMeta(row, { date: d })}
                      onSaveSummary={html => void saveSummary(row, html)}
                      onSync={() => setPendingSync(row)}
                      onDelete={() => setPendingDelete(row)}
                      kindToggle={toggle}
                      onToggleKind={toggle ? () => toggleKind(row, toggle) : undefined}
                      disabled={busy}
                      sortDisabled={busy || filtering || isPinnedChapter(rows, i)}
                      active={activeId === row.chapterId}
                      onActivate={() => setActiveId(row.chapterId)}
                      faded={filtering && !matched}
                      highlighted={matched}
                      offCanon={row.offCanon}
                      footnote={
                        matched && gap > 0
                          ? `${gap} chapter(s) ${idx === 0 ? 'before this' : 'since the last'}`
                          : null
                      }
                    />
                    {/* Nothing goes after the Epilogue — "+" on the card before
                        it inserts ahead of it instead. */}
                    {!isEpilogue && (
                      <button
                        data-no-dnd="true"
                        onClick={() => insertAt(i + 1)}
                        disabled={busy}
                        title="Insert a chapter here"
                        aria-label={`Insert a chapter after ${row.title}`}
                        className="absolute right-0 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-accent opacity-0 shadow-md transition-opacity hover:bg-accent/80 group-hover/insert:opacity-100 disabled:opacity-0"
                      >
                        <LuPlus size={12} className="text-white" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </SortableContext>

          {/* The dragged card follows the cursor at full opacity while its slot
              dims, so it is obvious what is moving and where it will land. */}
          <DragOverlay>
            {draggingRow && (
              <div className="w-[260px] opacity-90">
                <ChapterOutlineCard
                  chapterId={draggingRow.chapterId}
                  title={draggingRow.title}
                  seriesId={seriesId}
                  pov={draggingRow.pov}
                  date={draggingRow.date}
                  summary={summaries[draggingRow.chapterId]}
                  povSuggestions={[]}
                  onSavePov={() => {}}
                  onSaveDate={() => {}}
                  onSaveSummary={() => {}}
                  onSync={() => {}}
                  onDelete={() => {}}
                  disabled
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {pendingDelete && (
        <DeleteChapterDialog
          title={pendingDelete.title}
          busy={busy}
          onConfirm={() => deleteChapter(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <ConfirmDialog
        open={pendingSync !== null}
        title={`Use the AI summary for ${pendingSync?.title ?? 'this chapter'}?`}
        message="Your summary for this chapter is replaced with WriteAI’s generated one, which keeps updating as WriteAI re-analyses the chapter. Your summary is removed and can’t be brought back."
        confirmLabel="Replace mine"
        onConfirm={() => {
          if (pendingSync) void syncToAi([pendingSync.chapterId])
          setPendingSync(null)
        }}
        onCancel={() => setPendingSync(null)}
      />

      {bulkSyncOpen && (
        <SyncSummariesDialog
          candidates={syncCandidates}
          aiAvailable={aiAvailable}
          busy={busy}
          onConfirm={ids => {
            setBulkSyncOpen(false)
            void syncToAi(ids)
          }}
          onCancel={() => setBulkSyncOpen(false)}
        />
      )}
    </div>
  )
}
