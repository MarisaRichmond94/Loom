'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCamera, LuSearch, LuX } from 'react-icons/lu'
import { notify } from '@/lib/notifications'
import { portalHost } from '@/lib/portalHost'
import { CharacterAvatar, characterPhotoHref } from './CharacterAvatar'
import { RelationshipList } from './RelationshipList'
import { PhotoCropDialog } from './PhotoCropDialog'
import { AnchoredPopover, useClickOutside } from './AnchoredPopover'
import { CATEGORIES, type WriterCharacter } from '@/lib/characterSearch'

// Create or edit a WriteAI writer-character from Loom (LOOM-33 / LOOM-46).
//
// Explicit Save / Cancel, matching the event modal — ⌥⇧⏎ saves, ⌥⇧⎋ cancels,
// plain ⎋ cancels. This started out autosaving, which meant a half-typed new
// character was written on every pause: the tagged list gained and lost a card
// while you were still naming them, and the panel flashed through its loading
// state each time. A character is not a note; it exists once you say so.
//
// ⚠️ Every save sends the COMPLETE character. WriteAI's PUT has no model and
// stores the body verbatim (`chars[i] = body`), so a field left out of a
// payload is deleted rather than defaulted. Loom's proxy refuses partial
// bodies as a backstop, but the draft here is always whole.

const FIELD =
  'w-full rounded-lg border border-accent/20 bg-surface-overlay/40 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent placeholder:text-ink-faint'

/** A fresh WriteAI-shaped id. Its PUT is an upsert, so creating is just
 *  writing to an id nothing holds yet. Matches WriteAI's own `wc-` + 8 hex. */
function mintCharacterId(): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `wc-${hex}`
}

const EMPTY: Omit<WriterCharacter, 'id'> = {
  name: '',
  category: null,
  role: null,
  aliases: null,
  traits: [],
  arc_notes: null,
  goals: null,
  relationships: [],
  books: [],
  photo_url: null,
}

export default function CharacterModal({
  character,
  pool,
  books,
  onSaved,
  onDeleted,
  onClose,
}: {
  /** Absent when creating. */
  character?: WriterCharacter
  /** Every character, for the relationship picker and the duplicate-name check. */
  pool: WriterCharacter[]
  books: string[]
  /** Receives the saved record — the panel needs the id of a character it
   *  did not mint to tag it to the chapter. */
  onSaved: (character: WriterCharacter) => void | Promise<void>
  onDeleted: () => void | Promise<void>
  onClose: () => void
}) {
  const creating = !character
  const [draft, setDraft] = useState<WriterCharacter>(
    character ?? { id: mintCharacterId(), ...EMPTY },
  )
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [newTrait, setNewTrait] = useState('')
  const [relSearch, setRelSearch] = useState('')
  const [relNature, setRelNature] = useState('')
  const [relTarget, setRelTarget] = useState<string | null>(null)
  const [relOpen, setRelOpen] = useState(false)
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const relSearchRef = useRef<HTMLInputElement>(null)
  const relNatureRef = useRef<HTMLInputElement>(null)
  const relAnchorRef = useRef<HTMLDivElement>(null)
  const relPopRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (creating) nameRef.current?.focus() }, [creating])

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useClickOutside([relAnchorRef, relPopRef], () => setRelOpen(false), relOpen)

  // The relationship field is disabled until a target is chosen, and calling
  // focus() on a disabled input silently does nothing. Doing it in an effect
  // waits for the re-render that enables it — without this, choosing a
  // character left focus where it was and Tab had to be pressed twice.
  useEffect(() => {
    if (relTarget) relNatureRef.current?.focus()
  }, [relTarget])

  /**
   * A new character may not take an existing name.
   *
   * References are `wc-` ids now (LOOM-45), so a duplicate name no longer
   * breaks lookups — but it still makes every picker in both apps ambiguous to
   * a human, who has only the name to choose by. Applies to renames as well as
   * creation: renaming one character onto another's name is the same collision
   * arriving by a different route. `c.id !== draft.id` keeps a character from
   * colliding with itself.
   */
  const trimmedName = draft.name.trim()
  const duplicate =
    trimmedName.length > 0 &&
    pool.some(c => c.id !== draft.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase())
  const saveable = trimmedName.length > 0 && !duplicate

  const draftRef = useRef(draft)
  draftRef.current = draft

  const save = useCallback(async () => {
    const body = draftRef.current
    setSaving(true)
    try {
      const res = await fetch(`/api/writeai/characters/${body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? String(res.status))
      await onSaved(body)
      onClose()
    } catch (err) {
      notify('error', `Couldn't save ${body.name || 'that character'}. ${err instanceof Error ? err.message : ''}`.trim())
    } finally {
      setSaving(false)
    }
  }, [onSaved, onClose])

  // ⌥⇧⎋ and plain ⎋ close. While a delete is armed, ⎋ disarms it FIRST — one
  // press must not dismiss the safety and the dialog together.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const modified = e.altKey && e.shiftKey
      if (e.code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (confirmingDelete) setConfirmingDelete(false)
        else onClose()
        return
      }
      if (modified && e.code === 'Enter' && saveable && !saving) {
        e.preventDefault()
        e.stopPropagation()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, confirmingDelete, saveable, saving, save])

  const set = (patch: Partial<WriterCharacter>) => setDraft(d => ({ ...d, ...patch }))

  async function uploadPhoto(blob: Blob) {
    const form = new FormData()
    // Named so WriteAI's extension check passes; the cropper always emits JPEG.
    form.append('file', blob, `${draft.id}.jpg`)
    try {
      const res = await fetch(`/api/writeai/characters/${draft.id}/photo`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail ?? String(res.status))
      // WriteAI writes photo_url itself; mirror it so the avatar updates now.
      // Only the draft is updated — the character record itself is written
      // when you press Save, like every other field here. The image file is
      // already on disk either way, keyed by this character's id.
      set({ photo_url: data?.photo_url ?? draft.photo_url })
    } catch (err) {
      notify('error', `Couldn't upload that portrait. ${err instanceof Error ? err.message : ''}`.trim())
    }
  }

  async function remove() {
    try {
      const res = await fetch(`/api/writeai/characters/${draft.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      await onDeleted()
      onClose()
    } catch {
      notify('error', "Couldn't delete that character.")
    }
  }

  // Characters not already related, filtered by the search box.
  const relCandidates = pool.filter(
    c =>
      c.id !== draft.id &&
      !draft.relationships.some(r => r.target === c.id) &&
      c.name.toLowerCase().includes(relSearch.trim().toLowerCase()),
  )

  /** Picking a character does NOT commit — it fills the target and moves to
   *  the description, which is what Enter in a two-field row should do. */
  function chooseTarget(c: { id: string; name: string }) {
    // The id is what gets stored; the search box keeps showing the name,
    // because that is what the writer just picked and expects to see.
    setRelTarget(c.id)
    setRelSearch(c.name)
    setRelOpen(false)
    // Focus is handled by the effect above, once the field is enabled.
  }

  /**
   * Commit, then leave an empty row focused and ready.
   *
   * Relationships come in bursts — a family is seven of them — so the row
   * resets rather than closing, and focus returns to the search. Description
   * is optional: the relationship exists whether or not you have a word for it
   * yet, and demanding one would stop you recording it at all.
   */
  function commitRelationship() {
    if (!relTarget) return
    set({ relationships: [...draft.relationships, { target: relTarget, nature: relNature.trim() }] })
    setRelTarget(null)
    setRelSearch('')
    setRelNature('')
    setRelOpen(false)
    relSearchRef.current?.focus()
  }

  const firstName = trimmedName.split(/\s+/)[0] || 'they'

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'New character' : `Editing ${character!.name}`}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-accent/20 bg-surface-raised p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Upload a portrait"
            aria-label="Upload a portrait"
            className="group/photo relative shrink-0 rounded-full"
          >
            <CharacterAvatar name={trimmedName || '?'} src={characterPhotoHref(draft.photo_url)} size={52} />
            <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border border-surface-raised bg-surface-overlay text-ink-faint transition group-hover/photo:text-ink">
              <LuCamera size={11} />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) setPendingPhoto(f); e.target.value = '' }}
          />

          <div className="min-w-0 flex-1">
            {/* Editable when creating AND when renaming (LOOM-45). This field
                was read-only for existing characters because event casts and
                relationships referenced them by name, so a rename orphaned all
                of them silently. Those references are `wc-` ids now and the
                display name is derived at read time, which makes renaming an
                ordinary edit. */}
            <input
              ref={nameRef}
              value={draft.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="What is this character's name?"
              aria-label="Character name"
              className="w-full border-b border-accent/20 bg-transparent pb-1 text-sm font-semibold text-ink outline-none transition focus:border-accent placeholder:font-normal placeholder:text-ink-faint"
            />
            <input
              value={draft.aliases ?? ''}
              onChange={e => set({ aliases: e.target.value || null })}
              placeholder="Known aliases"
              aria-label="Known aliases"
              className="mt-1 w-full bg-transparent text-[11px] text-ink-muted outline-none placeholder:text-ink-faint"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {saving && <span className="text-[10px] italic text-ink-faint">Saving…</span>}
            {/* While creating there is nothing to delete — the character does
                not exist yet — so the ✕ means what its icon has always looked
                like it meant: close. Arming a delete here would fire a DELETE
                for an id that was never saved. Only an existing character gets
                the destructive version. */}
            {creating ? (
              <button
                type="button"
                onClick={onClose}
                title="Close without saving"
                aria-label="Close without saving"
                className="rounded p-1 text-ink-faint transition hover:bg-accent/10 hover:text-ink"
              >
                <LuX size={15} />
              </button>
            ) : confirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-muted">Delete everywhere?</span>
                <button
                  type="button"
                  onClick={remove}
                  className="rounded bg-red-500/90 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-red-500"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-[10px] text-ink-faint transition hover:text-ink"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                title="Delete this character"
                aria-label="Delete this character"
                className="rounded p-1 text-ink-faint transition hover:bg-red-500/10 hover:text-red-500"
              >
                <LuX size={15} />
              </button>
            )}
          </div>
        </div>

        {duplicate && (
          <p className="mt-2 text-[11px] text-red-500">
            A character called “{trimmedName}” already exists. Names still link records together, so
            they have to stay unique.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => set({ category: draft.category === c ? null : c })}
              aria-pressed={draft.category === c}
              className={`rounded-full border px-3 py-1 text-[11px] capitalize transition ${
                draft.category === c
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-accent/15 text-ink-faint hover:border-accent/40 hover:text-ink'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <textarea
          value={draft.goals ?? ''}
          onChange={e => set({ goals: e.target.value || null })}
          placeholder={`What are ${firstName}'s goals?`}
          aria-label="Goals"
          rows={3}
          className={`${FIELD} mt-3 resize-y`}
        />
        <textarea
          value={draft.arc_notes ?? ''}
          onChange={e => set({ arc_notes: e.target.value || null })}
          placeholder={`How will ${firstName} develop across this book?`}
          aria-label="Arc notes"
          rows={3}
          className={`${FIELD} mt-2 resize-y`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {draft.traits.map(t => (
            <span key={t} className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
              {t}
              <button
                type="button"
                onClick={() => set({ traits: draft.traits.filter(x => x !== t) })}
                aria-label={`Remove trait ${t}`}
                className="transition hover:text-red-400"
              >
                <LuX size={11} />
              </button>
            </span>
          ))}
          <input
            value={newTrait}
            onChange={e => setNewTrait(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const t = newTrait.trim()
              if (t && !draft.traits.includes(t)) set({ traits: [...draft.traits, t] })
              setNewTrait('')
            }}
            placeholder="+ Add Trait"
            aria-label="Add a trait"
            className="w-28 rounded-md border border-dashed border-accent/30 bg-transparent px-2.5 py-1 text-[11px] text-ink outline-none transition focus:w-40 focus:border-accent placeholder:text-ink-faint"
          />
        </div>

        <div className="mt-4">
          <RelationshipList
            relationships={draft.relationships}
            pool={pool}
            onRemove={i => set({ relationships: draft.relationships.filter((_, x) => x !== i) })}
          />
          {/* Always present, never a toggle: adding one relationship almost
              always means adding several, and making each start with a click
              is the friction that stops you doing it at all. */}
          <div className="mt-1.5 flex items-start gap-1.5">
            <div ref={relAnchorRef} className="relative flex-1">
              <LuSearch
                size={11}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={relSearchRef}
                value={relSearch}
                onChange={e => { setRelSearch(e.target.value); setRelTarget(null); setRelOpen(true) }}
                onFocus={() => setRelOpen(true)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRelOpen(false); return }
                  // Enter and Tab both take the top match and move on. Tab
                  // especially: it is already "go to the next field", and
                  // having it skip the half-filled row would be worse than
                  // useless.
                  if ((e.key === 'Enter' || e.key === 'Tab') && relCandidates.length > 0 && !relTarget) {
                    e.preventDefault()
                    chooseTarget(relCandidates[0])
                  }
                }}
                placeholder="Select character…"
                aria-label="Select a character to relate"
                className="w-full rounded-md border border-accent/20 bg-surface-overlay/40 py-1 pl-6 pr-2 text-[11px] text-ink outline-none transition focus:border-accent placeholder:text-ink-faint"
              />
              {/* Portalled: the dialog scrolls its own body, so an absolutely
                  positioned list near the bottom is clipped by it rather than
                  overflowing. It also flips above the field when there is no
                  room below. */}
              {relOpen && !relTarget && relCandidates.length > 0 && (
                <AnchoredPopover anchorRef={relAnchorRef} popoverRef={relPopRef}>
                  <div className="max-h-40 overflow-y-auto">
                    {relCandidates.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => chooseTarget(c)}
                        className="block w-full px-3 py-1.5 text-left text-[11px] text-ink-muted transition hover:bg-accent/10 hover:text-ink"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </AnchoredPopover>
              )}
            </div>
            <input
              ref={relNatureRef}
              value={relNature}
              onChange={e => setRelNature(e.target.value)}
              onKeyDown={e => {
                // Tab commits and starts the next one, so a whole family is
                // type-Tab-type-Tab without ever leaving the keyboard. Enter
                // does the same for anyone who reaches for it instead.
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitRelationship() }
              }}
              onBlur={() => { if (relTarget && relNature.trim()) commitRelationship() }}
              placeholder="Relationship"
              aria-label="Relationship"
              disabled={!relTarget}
              className="flex-1 rounded-md border border-accent/20 bg-surface-overlay/40 px-2 py-1 text-[11px] text-ink outline-none transition focus:border-accent placeholder:text-ink-faint disabled:opacity-50"
            />
          </div>
        </div>

        {/* Which books they appear in. Still hand-set: deriving it from the
            chapter tags is a later epic, and until then this is the only place
            it is authored. */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {books.map(b => {
            const on = draft.books.includes(b)
            return (
              <button
                key={b}
                type="button"
                onClick={() => set({ books: on ? draft.books.filter(x => x !== b) : [...draft.books, b] })}
                aria-pressed={on}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                  on
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-accent/15 text-ink-faint hover:border-accent/40 hover:text-ink'
                }`}
              >
                {b}
              </button>
            )
          })}
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-accent/10 pt-4">
          {duplicate && (
            <span className="text-[11px] text-red-500">That name is taken</span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-xs text-ink-muted transition hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!saveable || saving}
              title={trimmedName ? undefined : 'A character needs a name'}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {pendingPhoto && (
        <PhotoCropDialog
          file={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onCropped={async blob => { await uploadPhoto(blob); setPendingPhoto(null) }}
        />
      )}
    </div>,
    portalHost(),
  )
}
