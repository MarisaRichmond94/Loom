'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuX } from 'react-icons/lu'
import { ConditionRow } from '@/components/editor/conditionUI'

// Add or edit a book's settings in one dialog (LOOM-156, under LOOM-146).
//
// Replaces the inline "Add Book" title field, which could set a title and
// nothing else — so a new alt book had to be created and then fixed up from
// three separate controls on its card.
//
// It also closes a real gap: LOOM-151 shipped the book gate's mechanism,
// propagation and tests but NO editor for `Book.condition`, so a gate could
// only be authored with a SQL UPDATE. Chapter conditions had an editor; books
// did not. This is that editor, and it deliberately reuses `ConditionRow` from
// the chapter settings rather than growing a second condition UI to drift
// against the first.
//
// Genres and keywords are absent on purpose: they live on Series and books
// inherit them, so editing them from a dialog titled "Add Book" would silently
// change every other book in the series. They stay on the series Configure.

export type BookStatus = 'draft' | 'inProgress' | 'published'

export type BookSettingsValues = {
  title: string
  synopsis: string
  status: BookStatus
  canon: boolean
  condition: string | null
  divergesFromBookId: string | null
}

export type BookChoice = { id: string; title: string; label: string; canon: boolean }

export default function BookSettingsModal({
  mode, initial, canonBooks, variables, busy, error, onSubmit, onClose,
}: {
  mode: 'add' | 'edit'
  initial?: Partial<BookSettingsValues>
  /** Canon books this one may diverge from — the only legal parents. */
  canonBooks: BookChoice[]
  variables: { id: string; name: string; type: string; defaultValue?: string }[]
  busy?: boolean
  error?: string | null
  onSubmit: (values: BookSettingsValues) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? '')
  const [status, setStatus] = useState<BookStatus>(initial?.status ?? 'draft')
  const [canon, setCanon] = useState(initial?.canon ?? true)
  const [condition, setCondition] = useState<string | null>(initial?.condition ?? null)
  const [diverges, setDiverges] = useState<string | null>(initial?.divergesFromBookId ?? null)

  // Escape closes, matching every other dialog here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const canSubmit = title.trim().length > 0 && !busy

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      title: title.trim(),
      synopsis: synopsis.trim(),
      status,
      canon,
      condition,
      // A canon book has no divergence by definition; sending one would create
      // the stale pointer the PATCH clears.
      divergesFromBookId: canon ? null : diverges,
    })
  }

  const field = 'w-full bg-surface-base border border-accent/20 rounded px-3 py-2 text-sm text-ink outline-none focus:border-accent transition'
  const labelCls = 'text-xs uppercase tracking-widest text-ink-faint'

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 flex items-start justify-center z-[70] p-8 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={submit}
        className="bg-surface-raised border border-accent/20 rounded-xl p-6 w-full max-w-lg shadow-2xl flex flex-col gap-5 my-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">
            {mode === 'add' ? 'Add book' : 'Book settings'}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink transition">
            <LuX size={16} />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Title</span>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Untitled book"
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Description</span>
          <textarea
            value={synopsis}
            onChange={e => setSynopsis(e.target.value)}
            rows={3}
            placeholder="What happens in this book? Readers see this on the series page."
            className={`${field} resize-y leading-relaxed`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as BookStatus)} className={field}>
            <option value="draft">Draft — readers see “Coming Soon”</option>
            <option value="inProgress">In progress — the one you’re writing</option>
            <option value="published">Published — eligible to send to readers</option>
          </select>
        </label>

        {/* Canon membership. A segmented control rather than a checkbox: "canon"
            and "alt" are two kinds of book, not a property switched off. */}
        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Canon</span>
          <div className="flex rounded border border-accent/20 overflow-hidden text-sm">
            {([true, false] as const).map(v => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setCanon(v)}
                className={`flex-1 px-3 py-2 transition ${
                  canon === v ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {v ? 'Canon' : 'Alt (non-canon)'}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint italic leading-relaxed">
            {canon
              ? 'Exports to your manuscript folder, ingested by WriteAI, and can be sent to readers.'
              : 'An alternate timeline. Never exported, never seen by WriteAI, never sent to readers — but fully writable here.'}
          </p>
        </div>

        {!canon && (
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Diverges from</span>
            <select
              value={diverges ?? ''}
              onChange={e => setDiverges(e.target.value || null)}
              className={field}
            >
              <option value="">Choose a book…</option>
              {canonBooks.map(b => (
                <option key={b.id} value={b.id}>After {b.label} — {b.title}</option>
              ))}
            </select>
            <p className="text-xs text-ink-faint italic leading-relaxed">
              Where this branch leaves the canon line. Without it, Loom can’t place
              this book in the story, and character deaths and first appearances
              stop resolving inside it.
            </p>
          </label>
        )}

        {/* Shown for canon books too, and that is not an oversight: when a
            divergence splits the story, the CANON continuation needs the
            inverse gate. Canon and gated are independent. */}
        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Who reaches this book</span>
          <div className="rounded border border-accent/10 bg-surface-base/60 p-3">
            <ConditionRow
              condition={condition}
              variables={variables}
              onChange={setCondition}
              label="Show if:"
            />
          </div>
          <p className="text-xs text-ink-faint italic leading-relaxed">
            {condition
              ? canon
                ? 'Readers who don’t match won’t see this book. Make sure the default values of these variables DO match, or no one reaches it on a normal read-through.'
                : 'Only readers matching this reach the alt book. The canon book it replaces usually carries the opposite condition.'
              : 'No condition — every reader sees this book.'}
          </p>
        </div>

        {error && <p className="text-xs text-choice-kill">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded text-xs bg-accent text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : mode === 'add' ? 'Add book' : 'Save'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
