'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  LuBookmarkMinus,
  LuBookmarkPlus,
  LuCalendar,
  LuExternalLink,
  LuRefreshCw,
  LuSparkles,
  LuX,
} from 'react-icons/lu'
import OutlineRichText from '@/components/editor/OutlineRichText'
import StoryDatePicker from '@/components/editor/StoryDatePicker'
import { isSameStoryDay, povColorClass } from '@/lib/storyDate'
import type { ChapterKind } from '@/lib/chapterNumbering'
import type { ResolvedSummary } from '@/lib/outlineSummaries'
import { OUTLINE_CARD_H } from '@/components/editor/OutlineBoardSkeleton'

// One card on the book's outline board — one real Loom chapter.
//
// The look is the old outline card's (ported from WriteAI's ChapterCard), but
// everything on it now edits LOOM: POV and date are the chapter's own columns,
// and the summary is the writer's ChapterSummary. Nothing here writes to
// WriteAI.
//
// **Saves happen on blur, and only when something actually changed.** A card
// that was merely clicked into must write nothing: TipTap re-serialises HTML on
// load, so "the editor's value differs from what I was given" is true of a card
// nobody edited. The editor's onChange fires only on a real keystroke, so the
// `dirty` flag below is the honest signal.
//
// `data-no-dnd="true"` marks every interactive region. The board's pointer
// sensor walks up from the pointer target and refuses to start a drag inside
// one, which lets the whole card be a drag handle while its controls still
// behave like controls.

export type KindToggle = { kind: ChapterKind; label: string }

export default function ChapterOutlineCard({
  chapterId,
  title,
  seriesId,
  pov: storedPov,
  date: storedDate,
  summary,
  povSuggestions,
  onSavePov,
  onSaveDate,
  onSaveSummary,
  onSync,
  onDelete,
  kindToggle,
  onToggleKind,
  disabled = false,
  dragRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging = false,
  draggable = true,
  active = false,
  onActivate,
  faded = false,
  highlighted = false,
  offCanon = false,
  footnote,
}: {
  chapterId: string
  title: string
  seriesId: string
  pov: string | null
  date: string | null
  summary: ResolvedSummary
  /** Names already used as a POV in this book, for the inline combobox. */
  povSuggestions: string[]
  onSavePov: (pov: string) => void
  onSaveDate: (date: string | null) => void
  /** HTML. "" means the writer emptied it — the board stores that as "use the
   *  AI summary". */
  onSaveSummary: (html: string) => void
  onSync: () => void
  onDelete: () => void
  /** The prologue/epilogue switch, offered on the first and last card only. */
  kindToggle?: KindToggle | null
  onToggleKind?: () => void
  disabled?: boolean
  dragRef?: (el: HTMLDivElement | null) => void
  dragAttributes?: Record<string, unknown>
  dragListeners?: Record<string, unknown>
  dragStyle?: React.CSSProperties
  isDragging?: boolean
  /** False for a pinned Prologue/Epilogue, or while the board is filtered. */
  draggable?: boolean
  /** Owned by the board, not the card, so opening one closes any other. A
   *  click anywhere on the card activates it (and lets its summary scroll);
   *  a click outside the board clears it. */
  active?: boolean
  onActivate?: () => void
  /** A filter non-match — dimmed, never disabled. */
  faded?: boolean
  /** A filter match. */
  highlighted?: boolean
  /** Behind a choice — the canon walk never reaches it. */
  offCanon?: boolean
  /** The filter's run-length note ("3 chapter(s) since the last"). */
  footnote?: string | null
}) {
  const [pov, setPov] = useState(storedPov ?? '')
  const [povFocused, setPovFocused] = useState(false)
  const [date, setDate] = useState(storedDate ?? '')
  const [html, setHtml] = useState(summary.html)
  const [dirty, setDirty] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const calendarRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Follow the stored values when they change underneath (a save, a sync, a
  // refresh) — but never over an edit in progress.
  useEffect(() => setPov(storedPov ?? ''), [storedPov])
  useEffect(() => setDate(storedDate ?? ''), [storedDate])
  useEffect(() => {
    if (!dirty) setHtml(summary.html)
  }, [summary.html, dirty])

  // The picker is a portal, so an outside click has to be detected by hand.
  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        calendarRef.current?.contains(e.target as Node)
      ) {
        return
      }
      setPickerOpen(false)
      setPickerPos(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const povWidth = Math.max((pov || 'Enter POV').length, 4)
  const isAi = summary.source === 'ai'

  return (
    <div
      ref={dragRef}
      style={{ ...dragStyle, height: OUTLINE_CARD_H }}
      {...dragAttributes}
      {...dragListeners}
      onClick={() => onActivate?.()}
      data-testid={`outline-card-${chapterId}`}
      className={`group relative flex flex-col overflow-hidden rounded-lg bg-surface-raised transition-[opacity,border-color,box-shadow] ${
        offCanon
          ? 'border border-dashed border-amber-500/40 hover:border-amber-500/60'
          : 'border border-accent/10 hover:border-accent/25'
      } ${active ? 'ring-2 ring-purple-400/60' : highlighted ? 'ring-1 ring-accent/40' : ''} ${
        isDragging ? 'cursor-grabbing opacity-50' : draggable ? 'cursor-grab' : ''
      } ${faded ? 'opacity-40' : ''}`}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        {/* Fixed-height row, so a card with no badge lines up with one that has. */}
        <div className="flex h-5 items-center justify-between">
          {isAi ? (
            <span
              title="WriteAI wrote this summary. Edit it to make it yours."
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
            >
              <LuSparkles size={10} />
              AI generated
            </span>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            {kindToggle && onToggleKind && !disabled && (
              <button
                data-no-dnd="true"
                onClick={e => {
                  e.stopPropagation()
                  onToggleKind()
                }}
                title={kindToggle.label}
                aria-label={kindToggle.label}
                className="rounded p-0.5 text-ink-faint transition hover:text-accent"
              >
                {kindToggle.kind === 'chapter' ? <LuBookmarkMinus size={13} /> : <LuBookmarkPlus size={13} />}
              </button>
            )}
            {summary.canSync && !disabled && (
              <button
                data-no-dnd="true"
                onClick={e => {
                  e.stopPropagation()
                  onSync()
                }}
                title="Replace your summary with the AI-generated one"
                aria-label={`Sync ${title} with its AI-generated summary`}
                className="rounded p-0.5 text-ink-faint transition hover:text-accent"
              >
                <LuRefreshCw size={13} />
              </button>
            )}
            <Link
              data-no-dnd="true"
              href={`/author/${seriesId}/chapter/${chapterId}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open this chapter"
              aria-label={`Open ${title}`}
              className="rounded p-0.5 text-ink-faint transition hover:text-accent"
            >
              <LuExternalLink size={13} />
            </Link>
            {!disabled && (
              <button
                data-no-dnd="true"
                onClick={e => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="Delete this chapter"
                aria-label={`Delete ${title}`}
                className="rounded p-0.5 text-ink-faint transition hover:text-choice-kill"
              >
                <LuX size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-2 leading-none">
          <span className="shrink-0 text-sm font-bold leading-none text-ink">{title}</span>

          {/* The POV chip is an input wearing a chip's clothes: it colours
              itself from the name, and the colour is a hash so a character
              keeps theirs when chapters move around. */}
          <div data-no-dnd="true" className="relative min-w-0">
            <input
              type="text"
              value={pov}
              onChange={e => {
                setPov(e.target.value)
                setPovFocused(true)
              }}
              onFocus={() => setPovFocused(true)}
              onBlur={() => {
                // Delayed so a click on a suggestion lands before the list goes.
                setTimeout(() => setPovFocused(false), 150)
                const trimmed = pov.trim()
                if (!disabled && trimmed !== (storedPov ?? '')) onSavePov(trimmed)
              }}
              placeholder="Enter POV"
              aria-label={`POV for ${title}`}
              autoComplete="off"
              disabled={disabled}
              style={{ width: `calc(${povWidth}ch + 18px)` }}
              className={`max-w-full cursor-text rounded-full border-none px-2 py-0.5 text-[10px] font-medium outline-none transition focus:ring-1 focus:ring-accent/40 ${
                povFocused ? 'text-left' : 'text-center'
              } ${pov ? povColorClass(pov) : 'bg-surface-overlay text-ink-faint'}`}
            />
            {povFocused &&
              (() => {
                const matches = povSuggestions.filter(
                  s => s.toLowerCase().includes(pov.toLowerCase()) && s !== pov,
                )
                return matches.length > 0 ? (
                  <ul className="absolute left-0 z-20 mt-0.5 min-w-[120px] overflow-hidden rounded border border-accent/20 bg-surface-raised shadow-lg">
                    {matches.map(s => (
                      <li
                        key={s}
                        // onMouseDown, not onClick: the input's blur would
                        // otherwise unmount this list before a click lands.
                        onMouseDown={() => {
                          setPov(s)
                          setPovFocused(false)
                          if (s !== (storedPov ?? '')) onSavePov(s)
                        }}
                        className="cursor-pointer px-3 py-1.5 text-[11px] text-ink transition hover:bg-surface-overlay"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                ) : null
              })()}
          </div>
        </div>

        <div data-no-dnd="true" className="mt-1">
          <div className="flex items-center gap-2">
            <button
              ref={calendarRef}
              disabled={disabled}
              onClick={e => {
                e.stopPropagation()
                if (pickerOpen) {
                  setPickerOpen(false)
                  setPickerPos(null)
                  return
                }
                // Positioned from the button's rect and portalled to the body:
                // the card clips its own overflow, so an in-flow popover would
                // be cut off by the tile it belongs to.
                const rect = calendarRef.current?.getBoundingClientRect()
                if (rect) setPickerPos({ top: rect.bottom + 6, left: rect.left })
                setPickerOpen(true)
              }}
              title="Pick a story date"
              aria-label={`Story date for ${title}`}
              className={`transition ${pickerOpen ? 'text-accent' : 'text-ink-faint hover:text-ink-muted'}`}
            >
              <LuCalendar size={13} />
            </button>
            <span className="truncate text-[11px] text-ink-faint">
              {date || <span className="text-ink-faint/40">No date</span>}
            </span>
          </div>

          {pickerOpen &&
            pickerPos &&
            createPortal(
              <div
                ref={popoverRef}
                className="fixed z-50 rounded-lg border border-accent/20 bg-surface-raised p-3 shadow-xl"
                style={{ top: pickerPos.top, left: pickerPos.left }}
              >
                <StoryDatePicker
                  value={date}
                  onChange={val => {
                    // Picking the day that is already stored must not rewrite
                    // it. The manuscript's weekday comes from the story's own
                    // calendar; ours can only come from a real one, so
                    // re-formatting an unchanged date turns "Friday, December
                    // 4th" into "Tuesday, December 4th".
                    if (isSameStoryDay(val, storedDate)) return
                    setDate(val)
                    onSaveDate(val || null)
                  }}
                />
              </div>,
              document.body,
            )}
        </div>

        <div data-no-dnd="true" className="mt-2 flex min-h-0 flex-1 cursor-auto flex-col">
          <OutlineRichText
            value={html}
            onChange={next => {
              if (disabled) return
              setHtml(next)
              setDirty(true)
            }}
            onBlur={() => {
              if (!dirty) return
              setDirty(false)
              if (!disabled && html !== summary.html) onSaveSummary(isEmptyHtml(html) ? '' : html)
            }}
            editable={!disabled}
            placeholder="Plan / summary…"
            scrollable={active}
          />
        </div>

        {footnote && (
          <span className="shrink-0 truncate pt-1 text-[9px] italic text-ink-faint">{footnote}</span>
        )}
      </div>
    </div>
  )
}

/** TipTap's "empty" is `<p></p>`, not "". */
function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}
