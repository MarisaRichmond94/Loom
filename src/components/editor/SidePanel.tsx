'use client'

import { useRef, useState, type ReactNode } from 'react'
import { LuPin, LuScanText, LuX } from 'react-icons/lu'
import { PiNotebookThin } from 'react-icons/pi'
import { ReferenceList, type PinnedText } from './ReferencePanel'
import NotesPanel from './NotesPanel'
import ReviewPanel, { type ReviewSession } from './ReviewPanel'

export type PanelTab = 'notes' | 'refs' | 'review'

const MIN_WIDTH = 280

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
 * The right-hand dock: chapter notes, plus pinned reference snapshots when
 * there are any. Docked rather than overlaid — it's a flex sibling of the
 * writing column, which shrinks to make room.
 *
 * The two tabs have deliberately different lifetimes. Notes are persistent and
 * always exist, so they're the default tab and the panel's reason to be open.
 * Pins are in-memory and disposable, so the tab strip only appears once
 * something is pinned; with nothing pinned this is simply the notes panel.
 */
export default function SidePanel({
  tab,
  onTabChange,
  pins,
  onClearPins,
  notes,
  onNotesChange,
  notesSaving,
  review,
  reviewLoading,
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
  review: { review: ReviewSession | null; reason?: string; total?: number } | null
  reviewLoading: boolean
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

  function tabButton(value: PanelTab, icon: ReactNode, label: string) {
    const active = tab === value
    return (
      <button
        role="tab"
        aria-selected={active}
        aria-label={label}
        title={label}
        onClick={() => onTabChange(value)}
        className={`flex items-center justify-center w-7 h-7 rounded-md transition ${
          active ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-overlay'
        }`}
      >
        {icon}
      </button>
    )
  }

  const hasPins = pins.length > 0
  // The tab strip appeared only once something was pinned, because notes were
  // the sole alternative. Review is always addressable, so the strip is now
  // shown whenever there is more than one place to go.
  const hasTabs = hasPins || tab === 'review' || !!review

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

      <div className="sticky top-0 h-[calc(100vh-3.75rem-var(--loom-footer-h,0px))] overflow-y-auto flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-accent/10 shrink-0">
          {hasTabs ? (
            <div role="tablist" className="flex items-center gap-1">
              {tabButton('notes', <PiNotebookThin size={16} />, 'Notes (⌥⇧3)')}
              {hasPins && tabButton('refs', <LuPin size={13} />, 'Reference (⌥⇧2)')}
              {tabButton('review', <LuScanText size={14} />, 'Review')}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-ink-muted">
              <PiNotebookThin size={15} /> Notes
            </span>
          )}

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {tab === 'notes' && notesSaving && (
              <span className="text-[10px] text-ink-faint italic">Saving…</span>
            )}
            {tab === 'refs' && (
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
            ? <ReviewPanel data={review} loading={reviewLoading} />
            : <NotesPanel value={notes} onChange={onNotesChange} />}
      </div>
    </aside>
  )
}
