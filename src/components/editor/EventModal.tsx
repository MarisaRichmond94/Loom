'use client'

import { useEffect, useRef, useState } from 'react'
import { LuCalendar, LuClock, LuMapPin, LuPlus, LuTrash2, LuX } from 'react-icons/lu'
import { notify } from '@/lib/notifications'
import { fromDateInputValue, toDateInputValue, type WriterEvent } from '@/lib/eventSearch'

// Create or edit a WriteAI writer-event, without leaving Loom (LOOM-37).
//
// A modal rather than an inline panel form: WriteAI's own event form is 885
// lines and the dock's floor is 280px. This is the same field set, sized for
// a surface that can afford it.
//
// ⚠️ WriteAI's PATCH REPLACES the whole event — every field on its
// WriterEventBody has a default, so anything omitted is silently reset rather
// than left alone. This form therefore always submits the COMPLETE event, not
// a diff. Loom's proxy refuses partial bodies as a backstop, but relying on
// that to catch our own bugs would be the wrong way round.

const FIELD =
  'w-full rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent placeholder:text-ink-faint'

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
  const [picking, setPicking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  // ESC closes, except while a delete is armed — there it disarms first, so
  // the key cannot dismiss the safety and the dialog in one press.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      e.stopPropagation()
      if (confirmingDelete) setConfirmingDelete(false)
      else onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, confirmingDelete, busy])

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

  const available = characterPool.filter(c => !characters.includes(c))

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
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
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Character{characters.length === 1 ? '' : 's'}
              {characters.length > 0 && ` (${characters.length})`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {characters.map(name => (
                <span
                  key={name}
                  className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] text-accent"
                >
                  {name}
                  <button
                    onClick={() => setCharacters(cs => cs.filter(c => c !== name))}
                    aria-label={`Remove ${name}`}
                    className="transition hover:text-ink"
                  >
                    <LuX size={11} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setPicking(p => !p)}
                aria-expanded={picking}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-accent/30 px-2.5 py-1 text-[11px] text-ink-faint transition hover:border-accent/60 hover:text-ink"
              >
                <LuPlus size={11} /> Add Character
              </button>
            </div>
            {picking && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-accent/20 bg-surface-overlay/40 p-1">
                {available.length === 0 ? (
                  <p className="px-2 py-1.5 text-[11px] text-ink-faint">
                    {characterPool.length === 0
                      ? 'No characters found in WriteAI.'
                      : 'Everyone is already on this event.'}
                  </p>
                ) : (
                  available.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => { setCharacters(cs => [...cs, name]); setPicking(false) }}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-ink-muted transition hover:bg-accent/10 hover:text-ink"
                    >
                      {name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 transition focus-within:border-accent">
            <LuMapPin size={13} className="shrink-0 text-ink-faint" />
            {/* A datalist rather than a closed select: the pool is a
                convenience, and a location the writer has not used before must
                still be typeable. WriteAI folds new ones in on save. */}
            <input
              list="loom-event-locations"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Where does it happen?"
              aria-label="Event location"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <datalist id="loom-event-locations">
              {locationPool.map(l => <option key={l} value={l} />)}
            </datalist>
            {location && (
              <button
                onClick={() => setLocation('')}
                aria-label="Clear location"
                className="shrink-0 text-ink-faint transition hover:text-ink"
              >
                <LuX size={13} />
              </button>
            )}
          </label>
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
    </div>
  )
}
