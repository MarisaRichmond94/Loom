'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { LuCalendar, LuExternalLink, LuX } from 'react-icons/lu'
import OutlineRichText from './OutlineRichText'
import StoryDatePicker from './StoryDatePicker'
import { isSameStoryDay, povColorClass } from '@/lib/storyDate'
import type { OutlineCard as Card } from '@/lib/writerOutline'

// One outline card (LOOM-97), ported from WriteAI's ChapterCard.
//
// Everything is edited in place — POV, story date and summary — because that is
// how the plan pane works and this is meant to be the same surface, not a
// second one. There is no edit dialog.
//
// **Saves happen on blur, and only when something actually changed.** That is
// not just tidiness: `writer_summary` is HTML, TipTap re-serialises it on load,
// and WriteAI decides whether a summary is still machine-written by comparing
// it to `summary_source` EXACTLY. A card saved merely because it was focused
// would be marked hand-edited and stop being refreshed — silently, forever.
//
// `data-no-dnd="true"` marks every interactive region. The board's pointer
// sensor walks up from the pointer target and refuses to start a drag inside
// one, which is what lets the whole card be a drag handle while the controls on
// it still behave like controls.

export default function OutlineCard({
  card,
  label,
  seriesId,
  povSuggestions,
  onSave,
  onDelete,
  disabled = false,
  dragRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging = false,
  active = false,
  onToggleActive,
}: {
  card: Card
  label: string
  seriesId: string
  /** Names already used as a POV in this book, for the inline combobox. */
  povSuggestions: string[]
  onSave: (changes: Partial<Card>) => void
  onDelete: () => void
  disabled?: boolean
  dragRef?: (el: HTMLDivElement | null) => void
  dragAttributes?: Record<string, unknown>
  dragListeners?: Record<string, unknown>
  dragStyle?: React.CSSProperties
  isDragging?: boolean
  /** Whether this card is the one active card on the board. Owned by the
   * board, not the card, so opening one closes any other. */
  active?: boolean
  onToggleActive?: () => void
}) {
  const [pov, setPov] = useState(card.pov ?? '')
  const [povFocused, setPovFocused] = useState(false)
  const [date, setDate] = useState(card.date ?? '')
  const [summary, setSummary] = useState(card.writer_summary ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const calendarRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Follow the card when a save comes back from the server — auto-reconcile can
  // legitimately change what is stored.
  useEffect(() => setPov(card.pov ?? ''), [card.pov])
  useEffect(() => setDate(card.date ?? ''), [card.date])
  useEffect(() => setSummary(card.writer_summary ?? ''), [card.writer_summary])

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

  const synced = card.status === 'synced'
  const href = card.loom_id ? `/author/${seriesId}/chapter/${card.loom_id}` : null
  const povWidth = Math.max((pov || 'Enter POV').length, 4)

  return (
    <div
      ref={dragRef}
      style={dragStyle}
      {...dragAttributes}
      {...dragListeners}
      onClick={() => onToggleActive?.()}
      className={`group relative flex h-[250px] flex-col overflow-hidden rounded-lg transition-colors ${
        synced
          ? 'border border-accent/10 bg-surface-raised hover:border-accent/25'
          : 'border-2 border-dashed border-accent/40 bg-surface-raised/70 hover:border-accent/60'
      } ${active ? 'ring-2 ring-purple-400/60' : ''} ${isDragging ? 'cursor-grabbing opacity-50' : 'cursor-grab'}`}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <div className="flex items-center justify-between">
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              synced ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${synced ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {synced ? 'Synced' : 'Planned'}
          </span>

          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            {href && (
              <Link
                data-no-dnd="true"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title="Open this chapter in Loom"
                aria-label={`Open ${label} in Loom`}
                className="rounded p-0.5 text-ink-faint transition hover:text-accent"
              >
                <LuExternalLink size={13} />
              </Link>
            )}
            {!disabled && (
              <button
                data-no-dnd="true"
                onClick={e => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="Delete this card"
                aria-label={`Delete ${label}`}
                className="rounded p-0.5 text-ink-faint transition hover:text-choice-kill"
              >
                <LuX size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-2 leading-none">
          <span className="shrink-0 text-sm font-bold leading-none text-ink">{label}</span>

          {/* The POV chip is an input wearing a chip's clothes: it colours
              itself from the name, and the colour is a hash so a character
              keeps theirs when chapters move around. */}
          <div data-no-dnd="true" className="relative shrink-0">
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
                if (!disabled && trimmed !== (card.pov ?? '')) onSave({ pov: trimmed })
              }}
              placeholder="Enter POV"
              autoComplete="off"
              disabled={disabled}
              style={{ width: `calc(${povWidth}ch + 18px)` }}
              className={`cursor-text rounded-full border-none px-2 py-0.5 text-[10px] font-medium outline-none transition focus:ring-1 focus:ring-accent/40 ${
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
                          onSave({ pov: s })
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
              className={`transition ${pickerOpen ? 'text-accent' : 'text-ink-faint hover:text-ink-muted'}`}
            >
              <LuCalendar size={13} />
            </button>
            <span className="text-[11px] text-ink-faint">
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
                    // re-formatting an unchanged date turns the writer's
                    // "Friday, December 4th" into "Tuesday, December 4th".
                    if (isSameStoryDay(val, card.date)) return
                    setDate(val)
                    onSave({ date: val || null })
                  }}
                />
              </div>,
              document.body,
            )}
        </div>

        <div data-no-dnd="true" className="mt-2 flex min-h-0 flex-1 cursor-auto flex-col">
          <OutlineRichText
            value={summary}
            onChange={html => {
              if (!disabled) setSummary(html)
            }}
            onBlur={() => {
              // Compared against the STORED string, so a card that was only
              // focused saves nothing. See the note at the top of this file.
              if (!disabled && summary !== (card.writer_summary ?? '')) {
                onSave({ writer_summary: summary })
              }
            }}
            editable={!disabled}
            placeholder="Plan / summary…"
            scrollable={active}
          />
        </div>
      </div>
    </div>
  )
}
