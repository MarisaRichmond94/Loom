'use client'

import { useRef, useState, type ReactNode } from 'react'
import { LuCalendarDays, LuPin, LuScanText, LuUsers, LuX } from 'react-icons/lu'
import { PiNotebookThin } from 'react-icons/pi'
import { ReferenceList, type PinnedText } from './ReferencePanel'
import NotesPanel from './NotesPanel'
import ReviewPanel, { type ReviewSession } from './ReviewPanel'
import EventsPanel from './EventsPanel'
import CharactersPanel from './CharactersPanel'
import { tabsFitLabelled } from '@/lib/panelTabs'
import type { WriterEvent } from '@/lib/eventSearch'
import type { TaggedEvent } from './useChapterEvents'
import type { WriterCharacter } from '@/lib/characterSearch'
import type { TaggedCharacter } from './useChapterCharacters'

export type PanelTab = 'notes' | 'refs' | 'review' | 'events' | 'characters'

const MIN_WIDTH = 280

/** How many tabs the strip renders. Kept beside the tab list rather than
 *  derived from it, because the label-fit calculation needs it before the
 *  buttons are built. Bump when a tab is added. */
const TAB_COUNT = 5

/** Review needs materially more room than notes — it is a document, not a
 *  margin. A third of the viewport is the floor below which it stops being
 *  readable (KAN-22); the panel widens to meet it and stays there. */
export const REVIEW_MIN_FRACTION = 1 / 3

export function minWidthForTab(tab: PanelTab, viewport: number): number {
  return tab === 'review'
    ? Math.max(MIN_WIDTH, Math.round(viewport * REVIEW_MIN_FRACTION))
    : MIN_WIDTH
}

/**
 * The right-hand dock: the chapter's review, its notes, and pinned reference
 * snapshots. Docked rather than overlaid — it's a flex sibling of the writing
 * column, which shrinks to make room.
 *
 * The three tabs have deliberately different lifetimes: a review is stored in
 * WriteAI, notes are stored per chapter, pins are in-memory and vanish with the
 * chapter. That difference is what each tab's empty state explains — it is not
 * a reason to hide any of them. Pins used to appear only once something was
 * pinned, which left the way to discover pinning to be already doing it.
 */
export default function SidePanel({
  tab,
  onTabChange,
  pins,
  onClearPins,
  notes,
  onNotesChange,
  notesSaving,
  chapterPov,
  events,
  characters,
  review,
  reviewLoading,
  reviewCtx,
  width,
  onWidthChange,
  onClose,
}: {
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  pins: PinnedText[]
  onClearPins: () => void
  notes: string
  onNotesChange: (value: string) => void
  notesSaving: boolean
  /** The chapter's POV, for marking that character in the Characters tab. */
  chapterPov?: string | null
  /** Everything the Characters tab needs, passed through whole — the shape is
   *  exactly useChapterCharacters' return, so the two cannot drift apart. */
  characters: {
    characters: WriterCharacter[]
    tagged: TaggedCharacter[]
    taggedIds: Set<string>
    count: number
    loading: boolean
    unreachable: boolean
    onToggleTag: (writerCharacterId: string, tagged: boolean) => void | Promise<void>
    onSetCategory: (character: WriterCharacter, category: string) => void | Promise<void>
    onRetry: () => void
  }
  /** Everything the Events tab needs, passed through whole — the shape is
   *  exactly useChapterEvents' return, so the two cannot drift apart. */
  events: {
    events: WriterEvent[]
    tagged: TaggedEvent[]
    taggedIds: Set<string>
    count: number
    loading: boolean
    unreachable: boolean
    locations: string[]
    characterPool: string[]
    characterPhotos: Record<string, string | null>
    loadCharacterPool: () => void | Promise<void>
    onToggleTag: (writerEventId: string, tagged: boolean) => void | Promise<void>
    onRetry: () => void
    onRefresh: () => void | Promise<void>
  }
  review: { review: ReviewSession | null; reason?: string; total?: number; chapter?: number | null } | null
  reviewLoading: boolean
  reviewCtx: {
    seriesId: string
    bookId?: string
    chapterId: string
    bookTitle?: string
    getCanonText: () => string
    onSession: (s: ReviewSession | null) => void
    onRefetch: () => void
  }
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    // Panel is docked to the viewport's right edge, so its width is the gap
    // between the pointer and that edge. Clamp to a sane band — the floor
    // depends on the tab, since review needs a third of the viewport.
    const max = Math.min(720, Math.round(window.innerWidth * 0.6))
    const min = minWidthForTab(tab, window.innerWidth)
    onWidthChange(Math.min(Math.max(window.innerWidth - e.clientX, min), Math.max(max, min)))
  }

  // Labelled where there is room, icon-only where there is not (LOOM-41).
  // Three destinations is past the point where icons alone are guessable — a
  // pin and a notebook read as the same kind of thing until you have opened
  // both — so labels are dropped reluctantly, only once the dock is too narrow
  // to show them without wrapping. aria-label and title carry the name either
  // way; collapsing costs the always-on hint, not the affordance.
  const labelled = tabsFitLabelled(width, TAB_COUNT)

  // `count` rides in the tab rather than in the header's right-hand slot,
  // where "3 tagged" was eating enough width to collapse every label early.
  // A pill costs a fraction of that and only appears when there is something
  // to count.
  function tabButton(
    value: PanelTab,
    icon: ReactNode,
    label: string,
    count?: number,
  ) {
    const active = tab === value
    return (
      <button
        role="tab"
        aria-selected={active}
        aria-label={count ? `${label}, ${count} tagged` : label}
        title={count ? `${label} — ${count} tagged` : label}
        onClick={() => onTabChange(value)}
        className={`flex items-center gap-1.5 h-7 rounded-md text-[11px] font-medium transition ${
          labelled ? 'px-2' : 'px-1.5'
        } ${
          active ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-overlay'
        }`}
      >
        {icon}
        {labelled && label}
        {/* After the label when there is one, beside the icon when there is
            not — a count that trails the word reads as "Events: 3", where one
            wedged before it reads as a badge on the icon and competes with it. */}
        {count ? (
          <span
            className={`rounded-full px-1 text-[9px] tabular-nums leading-[1.4] ${
              active ? 'bg-accent/25 text-accent' : 'bg-surface-overlay text-ink-faint'
            }`}
          >
            {count}
          </span>
        ) : null}
      </button>
    )
  }

  const hasPins = pins.length > 0

  return (
    <aside
      style={{ width }}
      // Width animates so switching to Review — which jumps to a third of the
      // viewport — reads as the panel growing rather than the editor lurching.
      // Suppressed mid-drag: transitioning every pointermove fights the cursor.
      className={`relative z-30 shrink-0 border-l border-accent/10 bg-surface-raised${
        dragging ? '' : ' transition-[width] duration-200 ease-out'
      }`}
    >
      {/* Drag handle on the left edge — pointer capture keeps the drag alive
          even when the cursor moves off the thin strip. */}
      <div
        onPointerDown={e => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          setDragging(true)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          draggingRef.current = false
          setDragging(false)
        }}
        style={{ touchAction: 'none' }}
        title="Drag to resize"
        className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize group/resize"
      >
        <span className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 transition-colors ${dragging ? 'bg-accent' : 'bg-transparent group-hover/resize:bg-accent/40'}`} />
      </div>

      {/* overscroll-contain stops wheel events chaining out to the document.
          Without it, scrolling the dock scrolls the PAGE first — reaching a
          boundary here (or resting over a tab that manages its own scrolling,
          like Review) passes the gesture straight through to the editor
          behind. Two nested scrollers made that easy to hit. */}
      <div className="sticky top-0 h-[calc(100vh-3.75rem-var(--loom-footer-h,0px))] overflow-y-auto overscroll-contain flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-accent/10 shrink-0">
          {/* All four, always, in the order they are reached for: the review
              is the reason the panel is usually open, events and characters
              sit beside it because all three answer "what is this chapter" —
              and beside each other because they are the same kind of
              cross-app story data, notes are constant
              company, pins are occasional. Pins used to appear only when
              something was pinned, which meant the way to discover pinning was
              to already be doing it.
              This is also the cycle order for ⌥⇧< / ⌥⇧> (LOOM-56) — each tab
              used to carry its own ⌥⇧2–6 hotkey, but that grew unmanageable as
              tabs kept getting added, so the hints moved to the panel-level
              open (⌥⇧2) and step (⌥⇧< / >) shortcuts instead. */}
          <div role="tablist" className="flex items-center gap-0.5">
            {tabButton('review', <LuScanText size={13} />, 'Reviews')}
            {tabButton('events', <LuCalendarDays size={13} />, 'Events', events.count)}
            {tabButton('characters', <LuUsers size={13} />, 'Characters', characters.count)}
            {tabButton('notes', <PiNotebookThin size={14} />, 'Notes')}
            {tabButton('refs', <LuPin size={12} />, 'Pins')}
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {tab === 'notes' && notesSaving && (
              <span className="text-[10px] text-ink-faint italic">Saving…</span>
            )}
            {tab === 'refs' && hasPins && (
              <button
                onClick={onClearPins}
                title="Remove every pinned snapshot"
                className="text-[10px] uppercase tracking-widest text-ink-faint hover:text-ink transition"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              title="Close panel"
              aria-label="Close panel"
              className="text-ink-faint hover:text-ink transition"
            >
              <LuX size={15} />
            </button>
          </div>
        </div>

        {tab === 'refs'
          ? <ReferenceList pins={pins} />
          : tab === 'review'
            ? <ReviewPanel data={review} loading={reviewLoading} {...reviewCtx} />
            : tab === 'events'
              ? <EventsPanel {...events} bookId={reviewCtx.bookId} />
              : tab === 'characters'
                ? <CharactersPanel {...characters} bookId={reviewCtx.bookId} pov={chapterPov} />
                : <NotesPanel value={notes} onChange={onNotesChange} />}
      </div>
    </aside>
  )
}
