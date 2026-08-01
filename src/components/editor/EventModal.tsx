'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCalendar, LuCheck, LuClock, LuMapPin, LuPlus, LuSearch, LuTrash2, LuX } from 'react-icons/lu'
import { notify } from '@/lib/notifications'
import { fromDateInputValue, toDateInputValue, type WriterEvent } from '@/lib/eventSearch'

// Create or edit a WriteAI writer-event, without leaving Loom (LOOM-37).
//
// A modal rather than an inline panel form: WriteAI's own event form is 885
// lines and the dock's floor is 280px. Same field set, on a surface that can
// afford it.
//
// ⚠️ WriteAI's PATCH REPLACES the whole event — every field on its
// WriterEventBody has a default, so anything omitted is silently reset rather
// than left alone. This form therefore always submits the COMPLETE event, not
// a diff. Loom's proxy refuses partial bodies as a backstop, but relying on
// that to catch our own bugs would be the wrong way round.
//
// Rendered through a PORTAL, into <main>. Two things must hold at once:
//
//   * it must escape the dock's `relative z-30` stacking context — a fixed
//     child cannot outrank a sibling of its own context however high its
//     z-index, which is why z-[100] still lost to the chapter header;
//   * it must stay inside `.light-body`, the class that carries light mode.
//     That class lives on <main>, not on <html>, so portalling to <body>
//     escapes the theme and renders a dark modal over a light page.
//
// <main> is an ancestor of the dock and only sets overflow, which neither
// clips nor re-anchors a fixed child. It satisfies both.

/** Where portalled UI belongs — see the note above. */
function portalHost(): Element {
  return (typeof document !== 'undefined' && document.querySelector('main')) || document.body
}

const FIELD =
  'w-full rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent placeholder:text-ink-faint'

/** Four rows, then scroll. Matches the row height below (py-1.5 + 11px text). */
const LIST_MAX_HEIGHT = 4 * 28

/** Close a popover when the pointer goes down outside ALL of the given
 *  elements. Takes several because a portalled dropdown is not a DOM
 *  descendant of the control that opened it. */
function useClickOutside(
  refs: React.RefObject<HTMLElement | null>[],
  onOutside: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (refs.some(r => r.current?.contains(target))) return
      onOutside()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOutside, active])
}

/**
 * A dropdown anchored to a control but rendered at the document root.
 *
 * The dialog scrolls its own body, and an `overflow` ancestor CLIPS absolutely
 * positioned descendants — which is why the location list was being cut off at
 * the modal's edge. Portalling escapes the clip; fixed coordinates taken from
 * the anchor keep it attached.
 *
 * Flips above the anchor when there is not enough room below, so a control near
 * the bottom of the modal still shows its options.
 */
function AnchoredPopover({
  anchorRef,
  popoverRef,
  children,
  width,
  className = '',
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  popoverRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  /** Defaults to the anchor's width — right for a full-width field, wrong for
   *  a small button, which wants a readable list instead. */
  width?: number
  className?: string
}) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useEffect(() => {
    function place() {
      const anchor = anchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      // Header + list at full height, so the flip decision does not depend on
      // how many results happen to match.
      const needed = LIST_MAX_HEIGHT + 56
      const below = window.innerHeight - r.bottom
      const w = width ?? r.width
      setStyle(
        below < needed && r.top > below
          ? { position: 'fixed', left: r.left, width: w, bottom: window.innerHeight - r.top + 4 }
          : { position: 'fixed', left: r.left, width: w, top: r.bottom + 4 },
      )
    }
    place()
    window.addEventListener('resize', place)
    // Capture phase so the modal's own scroll container is heard too.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef, width])

  if (!style) return null
  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className={`z-[300] overflow-hidden rounded-md border border-accent/20 bg-surface-raised shadow-lg ${className}`}
    >
      {children}
    </div>,
    portalHost(),
  )
}

/**
 * The character picker, matching WriteAI's so the two apps do not teach
 * different muscle memory for the same job.
 *
 * Enter takes the first match, clears the query and KEEPS focus, so a cast of
 * several is added by typing rather than by aiming. Clicking a name toggles it
 * and clears the query too, which is why the list stays open on select.
 */
function CharacterPicker({
  pool,
  selected,
  onToggle,
}: {
  pool: string[]
  selected: string[]
  onToggle: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useClickOutside([anchorRef, popRef], () => setOpen(false), open)
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const matches = pool.filter(name => name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="mt-2 inline-block">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => { setQuery(''); setOpen(v => !v) }}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-accent/30 px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:border-accent hover:text-accent"
      >
        <LuPlus size={12} /> Add Character
      </button>

      {open && (
        <AnchoredPopover anchorRef={anchorRef} popoverRef={popRef} width={224}>
          <div className="p-2">
            <div className="relative">
              <LuSearch
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={inputRef}
                // autoFocus, not a useEffect: the popover renders null on its
                // first pass while it measures the anchor, so an effect keyed
                // on `open` fires before this input exists. autoFocus runs when
                // it actually mounts.
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && matches.length > 0) {
                    e.preventDefault()
                    onToggle(matches[0])
                    setQuery('')
                    inputRef.current?.focus()
                  }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
                }}
                placeholder="Search…"
                aria-label="Search characters"
                className="w-full rounded border border-accent/20 bg-surface-overlay/40 py-1 pl-6 pr-2 text-[11px] text-ink outline-none transition focus:border-accent placeholder:text-ink-faint"
              />
            </div>
          </div>
          <div className="overflow-y-auto pb-1" style={{ maxHeight: LIST_MAX_HEIGHT }}>
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-ink-faint">
                {pool.length === 0 ? 'No characters found in WriteAI.' : 'No characters found'}
              </p>
            ) : (
              matches.map(name => {
                const isSelected = selected.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { onToggle(name); setQuery(''); inputRef.current?.focus() }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] transition hover:bg-accent/10 ${
                      isSelected ? 'text-accent' : 'text-ink-muted'
                    }`}
                  >
                    {name}
                    {isSelected && <LuCheck size={12} className="shrink-0 text-accent" />}
                  </button>
                )
              })
            )}
          </div>
        </AnchoredPopover>
      )}
    </div>
  )
}

/**
 * Location combobox — pick an existing one or type a new one.
 *
 * WriteAI folds unseen locations into its pool on save, so this must stay open
 * to free text; a closed <select> would make the first use of a place
 * impossible. The "Create …" row appears only when the typed value is not
 * already in the pool, so it never duplicates.
 */
function LocationCombobox({
  value,
  pool,
  onChange,
}: {
  value: string
  pool: string[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useClickOutside([anchorRef, popRef], () => setOpen(false), open)

  const typed = value.trim()
  const matches = pool.filter(l => l.toLowerCase().includes(typed.toLowerCase()))
  const exact = pool.some(l => l.toLowerCase() === typed.toLowerCase())

  function commit(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <div>
      <div ref={anchorRef} className="relative">
        <LuMapPin
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // First match wins; otherwise keep what was typed as a new one.
              if (matches.length > 0) commit(matches[0])
              else if (typed) commit(typed)
            }
            if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
          }}
          placeholder="Select or create a location…"
          aria-label="Event location"
          className={`${FIELD} pl-8 ${value ? 'pr-8' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            aria-label="Clear location"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint transition hover:text-ink"
          >
            <LuX size={13} />
          </button>
        )}
      </div>
      {open && (matches.length > 0 || (typed && !exact)) && (
        <AnchoredPopover anchorRef={anchorRef} popoverRef={popRef}>
          <div className="overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          {typed && !exact && (
            <button
              type="button"
              onClick={() => commit(typed)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-accent transition hover:bg-accent/10"
            >
              <LuPlus size={12} /> Create “{typed}”
            </button>
          )}
          {matches.map(l => (
            <button
              key={l}
              type="button"
              onClick={() => commit(l)}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-ink-muted transition hover:bg-accent/10 hover:text-ink"
            >
              {l}
            </button>
          ))}
          </div>
        </AnchoredPopover>
      )}
    </div>
  )
}

export default function EventModal({
  event,
  characterPool,
  locationPool,
  onSaved,
  onDeleted,
  onClose,
}: {
  /** Absent when creating. */
  event?: WriterEvent
  characterPool: string[]
  locationPool: string[]
  onSaved: (event: WriterEvent) => void | Promise<void>
  onDeleted: (id: string) => void | Promise<void>
  onClose: () => void
}) {
  const editing = Boolean(event)

  const [title, setTitle] = useState(event?.title ?? '')
  const [dateValue, setDateValue] = useState(toDateInputValue(event?.date))
  const [time, setTime] = useState(event?.time ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [characters, setCharacters] = useState<string[]>(event?.characters ?? [])
  const [location, setLocation] = useState(event?.location ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  // Portals need a DOM to target, so nothing renders until mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const canSave = title.trim().length > 0 && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    // Every field, every time — see the PATCH warning above.
    const body = {
      title: title.trim(),
      date: dateValue ? fromDateInputValue(dateValue) : null,
      time: time || null,
      description,
      characters,
      location: location.trim() || null,
    }
    try {
      const res = await fetch(
        editing ? `/api/writeai/events/${event!.id}` : '/api/writeai/events',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? String(res.status))
      await onSaved(data as WriterEvent)
      onClose()
    } catch (err) {
      setBusy(false)
      notify('error', `Couldn't save that event. ${err instanceof Error ? err.message : ''}`.trim())
    }
  }

  async function remove() {
    if (!event) return
    setBusy(true)
    try {
      const res = await fetch(`/api/writeai/events/${event.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      await onDeleted(event.id)
      onClose()
    } catch {
      setBusy(false)
      notify('error', "Couldn't delete that event.")
    }
  }

  // Keyboard. Declared after save/remove so it closes over them.
  //
  // ⌥⇧⏎ saves and ⌥⇧⎋ cancels, matching how every other Loom shortcut is
  // spelled. Plain ⎋ also cancels, because a modal that ignores Escape is
  // surprising in a way that no house style justifies.
  //
  // While a delete is armed, Escape disarms it FIRST — one press must not be
  // able to dismiss the safety and the dialog together.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return
      const escape = e.code === 'Escape'
      const modified = e.altKey && e.shiftKey
      if (escape || (modified && e.code === 'Enter')) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (escape) {
        if (confirmingDelete) setConfirmingDelete(false)
        else onClose()
        return
      }
      if (modified && e.code === 'Enter') void save()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, confirmingDelete, busy, canSave, title, dateValue, time, description, characters, location])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Editing ${event!.title}` : 'New event'}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-accent/20 bg-surface-raised shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-accent/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">
              {editing ? event!.title : 'New Event'}
            </h2>
            {editing && <p className="mt-0.5 text-[11px] text-ink-faint">Editing event details</p>}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded p-1 text-ink-faint transition hover:bg-accent/10 hover:text-ink disabled:opacity-50"
          >
            <LuX size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What happens in this event?"
            aria-label="Event title"
            className={FIELD}
          />

          <div className="flex flex-wrap gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 transition focus-within:border-accent">
              <LuCalendar size={13} className="shrink-0 text-ink-faint" />
              <input
                type="date"
                value={dateValue}
                onChange={e => setDateValue(e.target.value)}
                aria-label="Event date"
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </label>
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 transition focus-within:border-accent">
              <LuClock size={13} className="shrink-0 text-ink-faint" />
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                aria-label="Event time"
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </label>
          </div>

          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the event…"
            aria-label="Event description"
            rows={4}
            className={`${FIELD} resize-y`}
          />

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Character(s){characters.length > 0 && ` (${characters.length})`}
            </p>
            {characters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {characters.map(name => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => setCharacters(cs => cs.filter(c => c !== name))}
                      title={`Remove ${name}`}
                      aria-label={`Remove ${name}`}
                      className="transition hover:text-red-400"
                    >
                      <LuX size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <CharacterPicker
              pool={characterPool}
              selected={characters}
              onToggle={name =>
                setCharacters(cs => (cs.includes(name) ? cs.filter(c => c !== name) : [...cs, name]))
              }
            />
          </div>

          <LocationCombobox value={location} pool={locationPool} onChange={setLocation} />
        </div>

        <div className="flex items-center gap-2 border-t border-accent/10 px-5 py-4">
          {/* Two-stage rather than a nested confirm dialog: deleting here
              removes the event from WriteAI ENTIRELY — every chapter and every
              timeline, not just this chapter's tag. That deserves a second
              press, and a modal on top of a modal deserves nothing. */}
          {editing && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-red-500 transition hover:text-red-400 disabled:opacity-50"
            >
              <LuTrash2 size={13} /> Delete
            </button>
          )}
          {editing && confirmingDelete && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">Delete everywhere?</span>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-md bg-red-500/90 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="text-[11px] text-ink-faint transition hover:text-ink"
              >
                Keep
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="text-xs text-ink-muted transition hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={title.trim() ? undefined : 'An event needs a title'}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalHost(),
  )
}
