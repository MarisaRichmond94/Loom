'use client'

import { useRef, useState, type ReactNode } from 'react'
import { LuPin, LuX } from 'react-icons/lu'
import { PiNotebookThin } from 'react-icons/pi'
import { ReferenceList, type PinnedText } from './ReferencePanel'
import NotesPanel from './NotesPanel'

export type PanelTab = 'notes' | 'refs'

const MIN_WIDTH = 280

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
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    // Panel is docked to the viewport's right edge, so its width is the gap
    // between the pointer and that edge. Clamp to a sane band.
    const max = Math.min(720, Math.round(window.innerWidth * 0.6))
    onWidthChange(Math.min(Math.max(window.innerWidth - e.clientX, MIN_WIDTH), max))
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

  return (
    <aside
      style={{ width }}
      className="relative z-30 shrink-0 border-l border-accent/10 bg-surface-raised"
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
          {hasPins ? (
            <div role="tablist" className="flex items-center gap-1">
              {tabButton('notes', <PiNotebookThin size={16} />, 'Notes (⌥⇧3)')}
              {tabButton('refs', <LuPin size={13} />, 'Reference (⌥⇧2)')}
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
          : <NotesPanel value={notes} onChange={onNotesChange} />}
      </div>
    </aside>
  )
}
