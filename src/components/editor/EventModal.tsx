'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuBookOpen, LuCalendar, LuCheck, LuClock, LuExternalLink, LuMapPin, LuPencil, LuPlus, LuSearch, LuTrash2, LuX } from 'react-icons/lu'
import { notify } from '@/lib/notifications'
import { formatEventWhen, fromDateInputValue, toDateInputValue, type WriterEvent } from '@/lib/eventSearch'
import { portalHost } from '@/lib/portalHost'
import type { CharacterOption } from '@/lib/writerCharacters'
import { AnchoredPopover, LIST_MAX_HEIGHT, useClickOutside } from './AnchoredPopover'
import { CharacterAvatar } from './CharacterAvatar'
import type { BookEventAppearance } from '@/lib/chapterEvents'

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

const FIELD =
  'w-full rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent placeholder:text-ink-faint'

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
  pool: CharacterOption[]
  /** `wc-` ids, not names — see CharacterOption. */
  selected: string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useClickOutside([anchorRef, popRef], () => setOpen(false), open)
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const matches = pool.filter(c => c.name.toLowerCase().includes(query.trim().toLowerCase()))

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
                    onToggle(matches[0].id)
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
              matches.map(c => {
                const isSelected = selected.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onToggle(c.id); setQuery(''); inputRef.current?.focus() }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] transition hover:bg-accent/10 ${
                      isSelected ? 'text-accent' : 'text-ink-muted'
                    }`}
                  >
                    {c.name}
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

/** A chapter this event can be tagged to on create (LOOM-103). */
export type ChapterChoice = { id: string; title: string; number: number | null }

type AppearanceGroup = { bookId: string; bookTitle: string; appearances: BookEventAppearance[] }

/**
 * Buckets appearances by book for the "Referenced in" pills (LOOM-138).
 *
 * At book scope `bookId`/`bookTitle` are absent by design (see
 * BookEventAppearance) — there is only ever one book in play there, so
 * everything lands in a single untitled group and renders as a flat pill row,
 * unchanged from before this ticket. At series scope, appearances arrive
 * already ordered by book then chapter (groupSeriesEvents), so Map insertion
 * order is enough — no re-sort needed here.
 */
function groupAppearances(appearances: BookEventAppearance[]): AppearanceGroup[] {
  const groups = new Map<string, AppearanceGroup>()
  for (const a of appearances) {
    const key = a.bookId ?? ''
    let group = groups.get(key)
    if (!group) {
      group = { bookId: key, bookTitle: a.bookTitle ?? '', appearances: [] }
      groups.set(key, group)
    }
    group.appearances.push(a)
  }
  return [...groups.values()]
}

export default function EventModal({
  event,
  characterPool,
  locationPool,
  defaultDate,
  chapterChoices,
  initialMode = 'edit',
  appearances = [],
  seriesId,
  characterPhotos = {},
  onSaved,
  onDeleted,
  onClose,
}: {
  /** Absent when creating. */
  event?: WriterEvent
  characterPool: CharacterOption[]
  locationPool: string[]
  /** Date to prefill when creating — the most recently updated event's date,
   *  so a run of same-day entries doesn't need re-picking the date each
   *  time. Ignored when editing an existing event. */
  defaultDate?: string | null
  /** Chapters this event can be tagged to as it is created (LOOM-103).
   *
   *  Absent from the dock's create flow, which is already open ON a chapter
   *  and tags implicitly — a second, redundant picker there would be asking a
   *  question it has already answered. Present only where the caller cannot
   *  infer a chapter: the book page's Timeline tab, which is filtered BY tag,
   *  so an untagged new event would be created and immediately vanish.
   *
   *  Optional even when offered. An event with no chapter yet is legitimate,
   *  and blocking the save to force a tag would be worse than the vanishing it
   *  prevents — the caller handles the unset case instead. */
  chapterChoices?: ChapterChoice[]
  /** How the dialog opens on an EXISTING event.
   *
   *  'edit' is the default, and is right where the click already MEANT edit —
   *  the dock's pencil, which sits beside a card that has already expanded to
   *  show the same content. Landing in the form there is the whole point.
   *
   *  'view' is for surfaces where clicking the event is how you READ it. The
   *  timeline has no expand-in-place, so without this the only way to look at
   *  an event is to open its editor, which puts every field one stray
   *  keystroke from a change you did not intend to make.
   *
   *  Ignored when creating: there is nothing to view yet. */
  initialMode?: 'view' | 'edit'
  /** Chapters referencing this event, shown in view mode. Loom-side data, so
   *  it is passed in rather than fetched — the caller already has it. */
  appearances?: BookEventAppearance[]
  /** For linking a "Referenced in" pill to `/author/[seriesId]/chapter/[chapterId]`
   *  in a new tab (LOOM-138). Required alongside `appearances` — view mode is
   *  the only mode that renders them. */
  seriesId: string
  /** Portraits keyed by character NAME, for the cast in view mode. */
  characterPhotos?: Record<string, string | null>
  /** `chapterId` is the picker's choice, present only when `chapterChoices`
   *  was offered and used. The caller does the tagging: this modal talks to
   *  WriteAI, and the chapter join is Loom's. */
  onSaved: (event: WriterEvent, chapterId?: string) => void | Promise<void>
  onDeleted: (id: string) => void | Promise<void>
  onClose: () => void
}) {
  const editing = Boolean(event)
  const appearanceGroups = useMemo(() => groupAppearances(appearances), [appearances])

  const [title, setTitle] = useState(event?.title ?? '')
  const [dateValue, setDateValue] = useState(
    toDateInputValue(event ? event.date : defaultDate),
  )
  const [time, setTime] = useState(event?.time ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [characters, setCharacters] = useState<string[]>(event?.characters ?? [])
  const [location, setLocation] = useState(event?.location ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  // '' = no chapter. Only ever offered when creating: tagging an EXISTING
  // event is the Events tab's job, and doing it from here as a side effect of
  // an edit would be a second, invisible mutation.
  const [chapterId, setChapterId] = useState('')
  const showChapterPicker = !editing && (chapterChoices?.length ?? 0) > 0
  // Creating is always the form — there is nothing to view yet.
  const [mode, setMode] = useState<'view' | 'edit'>(editing ? initialMode : 'edit')
  const viewing = mode === 'view'

  const titleRef = useRef<HTMLInputElement>(null)
  // Focuses on entering the form, not just on mount: opening in view mode and
  // then pressing Edit must land the caret in the title the same way opening
  // straight into the form does.
  useEffect(() => { if (!viewing) titleRef.current?.focus() }, [viewing])

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
      await onSaved(data as WriterEvent, showChapterPicker && chapterId ? chapterId : undefined)
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
      // Save is the form's shortcut, so it does nothing while reading.
      if (modified && e.code === 'Enter' && !viewing) void save()
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
        <div className="flex items-center justify-between gap-4 border-b border-accent/10 px-5 py-4">
          {/* The pencil replaced an "Editing event details" subtitle, which
              described the dialog you were already looking at and cost a line
              of the header to do it. The control that changes something is
              worth that space; the caption was not.

              Beside the title rather than in the footer: it acts ON the title
              and the fields under it, and the footer already carries Close. */}
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-ink">
              {editing ? event!.title : 'New Event'}
            </h2>
            {editing && viewing && (
              <button
                type="button"
                onClick={() => setMode('edit')}
                title="Edit this event"
                aria-label={`Edit event: ${event!.title}`}
                className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-accent/10 hover:text-ink"
              >
                <LuPencil size={13} />
              </button>
            )}
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

        {viewing ? (
          /* Read mode (LOOM-103 review feedback). Clicking an event on the
             timeline is how you READ it — opening straight into the editor put
             every field one stray keystroke from an unintended change. Mirrors
             the dock's expanded card rather than inventing a third layout for
             the same facts. */
          <div className="flex flex-col gap-4 p-5">
            {formatEventWhen({ date: event!.date, time: event!.time }) && (
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <LuCalendar size={13} className="shrink-0 text-ink-faint" />
                {formatEventWhen({ date: event!.date, time: event!.time })}
              </p>
            )}

            {event!.location && (
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <LuMapPin size={13} className="shrink-0 text-ink-faint" />
                {event!.location}
              </p>
            )}

            {event!.description ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
                {event!.description}
              </p>
            ) : (
              <p className="text-[13px] italic text-ink-faint">No description yet.</p>
            )}

            {event!.characters.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
                  Character(s) ({event!.characters.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {event!.characters.map(id => {
                    // Stored as an id, shown by name — and the photo map is
                    // keyed by the RESOLVED name, not the raw reference.
                    const label = characterPool.find(c => c.id === id)?.name ?? 'Unknown character'
                    return (
                      <span
                        key={id}
                        className="flex items-center gap-1.5 rounded-lg border border-accent/15 bg-surface-overlay/60 py-1 pl-1 pr-2.5"
                      >
                        <CharacterAvatar name={label} src={characterPhotos[label]} size={28} />
                        <span className="text-[11px] font-medium text-ink">{label}</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {appearances.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
                  Referenced in
                </p>
                {/* Grouped by book at series scope, where a bare "Ch. 3" is
                    ambiguous across five books (LOOM-138) — flat at book
                    scope, where appearances carry no bookId/bookTitle by
                    design and there is nothing to group. Each pill opens
                    that chapter's editor in a new tab. */}
                <div className="mt-2 flex max-h-32 flex-col gap-1.5 overflow-y-auto pr-0.5">
                  {appearanceGroups.map(group => (
                    <div key={group.bookId || 'book'} className="flex items-center gap-1.5 overflow-x-auto pb-px">
                      {group.bookTitle && (
                        <span
                          title={group.bookTitle}
                          className="sticky left-0 max-w-[120px] shrink-0 cursor-default truncate bg-surface-raised text-[11px] font-semibold text-ink-muted select-none"
                        >
                          {group.bookTitle}
                        </span>
                      )}
                      <div className="flex shrink-0 gap-1.5">
                        {group.appearances.map(a => (
                          <a
                            key={a.chapterId}
                            href={`/author/${seriesId}/chapter/${a.chapterId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={
                              a.nonCanon
                                ? 'Referenced here only on a non-canon branch — opens in a new tab'
                                : `Open ${a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`} in a new tab`
                            }
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition hover:text-ink ${
                              a.nonCanon
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:border-amber-500/60'
                                : 'border-accent/20 bg-surface-overlay/60 text-ink-muted hover:border-accent-muted'
                            }`}
                          >
                            <LuExternalLink size={10} className="opacity-70" />
                            {a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
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
                {characters.map(id => {
                  // Stored as an id; shown by name. An id the pool no longer
                  // knows is surfaced as unknown rather than dropped — a cast
                  // member that silently vanishes is the bug being fixed.
                  const label = characterPool.find(c => c.id === id)?.name ?? 'Unknown character'
                  return (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => setCharacters(cs => cs.filter(c => c !== id))}
                      title={`Remove ${label}`}
                      aria-label={`Remove ${label}`}
                      className="transition hover:text-red-400"
                    >
                      <LuX size={11} />
                    </button>
                  </span>
                  )
                })}
              </div>
            )}
            <CharacterPicker
              pool={characterPool}
              selected={characters}
              onToggle={id =>
                setCharacters(cs => (cs.includes(id) ? cs.filter(c => c !== id) : [...cs, id]))
              }
            />
          </div>

          <LocationCombobox value={location} pool={locationPool} onChange={setLocation} />

          {/* Only where the caller cannot infer a chapter — see chapterChoices.
              A plain <select> rather than the comboboxes above: the list is
              this book's chapters, closed and ordered, where locations are
              free text and characters are a long searchable pool. */}
          {showChapterPicker && (
            <label className="flex items-center gap-2 rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 transition focus-within:border-accent">
              <LuBookOpen size={13} className="shrink-0 text-ink-faint" />
              <select
                value={chapterId}
                onChange={e => setChapterId(e.target.value)}
                aria-label="Tag this event to a chapter"
                className="w-full bg-transparent text-sm text-ink outline-none"
              >
                <option value="">Not tagged to a chapter yet</option>
                {chapterChoices!.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.number === null ? c.title : `Ch. ${c.number} — ${c.title}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        )}

        <div className="flex items-center gap-2 border-t border-accent/10 px-5 py-4">
          {/* Two-stage rather than a nested confirm dialog: deleting here
              removes the event from WriteAI ENTIRELY — every chapter and every
              timeline, not just this chapter's tag. That deserves a second
              press, and a modal on top of a modal deserves nothing. */}
          {/* Edit mode only. Delete removes the event from WriteAI entirely,
              which is not something a dialog you opened to READ should be
              offering — Edit is one click away and says what you are doing. */}
          {editing && !viewing && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-red-500 transition hover:text-red-400 disabled:opacity-50"
            >
              <LuTrash2 size={13} /> Delete
            </button>
          )}
          {editing && !viewing && confirmingDelete && (
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
              {/* "Close" while reading: nothing has been entered, so "Cancel"
                  would imply discarding something. */}
              {viewing ? 'Close' : 'Cancel'}
            </button>
            {/* No Edit button here — the pencil beside the title is that
                control, and two ways into the form in a dialog this size is
                clutter rather than convenience. So view mode's footer is just
                Close, and the primary action stays the one that WRITES. */}
            {!viewing && (
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                title={title.trim() ? undefined : 'An event needs a title'}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    portalHost(),
  )
}
