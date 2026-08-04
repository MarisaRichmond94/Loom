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
  allowDelete = true,
  bookContext,
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
  /**
   * Whether deleting the character outright is offered (LOOM-88).
   *
   * True in the Characters tab, where the cast is the subject and the
   * consequence is in view. False when this modal is opened from a book page,
   * which has its own "clear book data" control for Loom's overlay: deleting
   * the WriteAI record from there would also strip the character out of every
   * writer-event that names them and out of canon lookup, which is not what
   * someone editing one book is asking for.
   */
  allowDelete?: boolean
  /**
   * Loom's half, when this modal is opened from a book (LOOM-88).
   *
   * Present: the modal also edits what the character is in THIS book — age,
   * per-book portrait — and across the series: starred, first appearance,
   * death, last appearance. Absent (the chapter dock): WriteAI's fields only,
   * exactly as before.
   *
   * One modal rather than two stacked ones. The fields have different owners
   * and different write rules, but they describe one person, and a dialog that
   * opens a second dialog to finish the same edit is a seam showing through.
   */
  bookContext?: {
    seriesId: string
    bookId: string
    bookTitle: string
    books: { id: string; title: string; order: number }[]
    overlay: {
      age: number | null
      starred: boolean
      firstBookId: string | null
      deathBookId: string | null
      lastBookId: string | null
      hasOverride: boolean
      /** Already resolved through the portrait chain. */
      portraitUrl: string | null
      hasBookAvatar: boolean
    } | null
    /** Called after Loom's half is written, so the page can refetch. */
    onOverlaySaved: () => void | Promise<void>
  }
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

  // Loom's half. Kept as its own draft so Cancel abandons both halves
  // together, and so the WriteAI payload never accidentally carries a Loom
  // field into a PUT that stores bodies verbatim.
  const ov = bookContext?.overlay
  const [bookAge, setBookAge] = useState(ov?.age != null ? String(ov.age) : '')
  const [starred, setStarred] = useState(ov?.starred ?? false)
  const [firstBookId, setFirstBookId] = useState(ov?.firstBookId ?? '')
  const [deathBookId, setDeathBookId] = useState(ov?.deathBookId ?? '')
  const [lastBookId, setLastBookId] = useState(ov?.lastBookId ?? '')
  // A newly chosen per-book portrait, and the intent to drop the existing one.
  const [bookPhoto, setBookPhoto] = useState<Blob | null>(null)
  const [bookPhotoPreview, setBookPhotoPreview] = useState<string | null>(null)
  const [clearingBookData, setClearingBookData] = useState(false)
  const [clearBookPhoto, setClearBookPhoto] = useState(false)
  const [pendingBookPhoto, setPendingBookPhoto] = useState<File | null>(null)
  const bookPhotoRef = useRef<HTMLInputElement>(null)
  const ageInvalid = bookAge.trim() !== '' && !/^\d+$/.test(bookAge.trim())

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
  const saveable = trimmedName.length > 0 && !duplicate && !ageInvalid

  const draftRef = useRef(draft)
  draftRef.current = draft
  // save() is memoised and bound to ⌥⇧⏎, so it reads Loom's fields through
  // refs rather than being rebuilt on every keystroke.
  const bookContextRef = useRef(bookContext); bookContextRef.current = bookContext
  const ageRef = useRef(bookAge); ageRef.current = bookAge
  const starredRef = useRef(starred); starredRef.current = starred
  const firstBookRef = useRef(firstBookId); firstBookRef.current = firstBookId
  const deathBookRef = useRef(deathBookId); deathBookRef.current = deathBookId
  const lastBookRef = useRef(lastBookId); lastBookRef.current = lastBookId
  const bookPhotoRefValue = useRef(bookPhoto); bookPhotoRefValue.current = bookPhoto
  const clearPhotoRef = useRef(clearBookPhoto); clearPhotoRef.current = clearBookPhoto

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

      // Loom's half, after WriteAI's — the overlay is keyed by the character's
      // id, so the record has to exist first. Sent as a PARTIAL patch: absent
      // means "leave alone" here, the exact opposite of the verbatim PUT
      // above, which is why the two payloads are built separately and never
      // from one object.
      const ctx = bookContextRef.current
      if (ctx) {
        const age = ageRef.current.trim() === '' ? null : Number(ageRef.current.trim())
        await fetch(`/api/series/${ctx.seriesId}/writer-characters/${body.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            starred: starredRef.current,
            firstBookId: firstBookRef.current || null,
            deathBookId: deathBookRef.current || null,
            lastBookId: lastBookRef.current || null,
          }),
        })
        await fetch(`/api/series/${ctx.seriesId}/books/${ctx.bookId}/writer-characters/${body.id}/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ age }),
        })
        // "Use default" is applied on Save like every other field here, not
        // the moment it is clicked — Cancel has to mean cancel.
        if (clearPhotoRef.current) {
          await fetch(`/api/series/${ctx.seriesId}/books/${ctx.bookId}/writer-characters/${body.id}/avatar`, {
            method: 'DELETE',
          })
        }
        const photo = bookPhotoRefValue.current
        if (photo) {
          const form = new FormData()
          form.append('avatar', photo, 'avatar.jpg')
          await fetch(`/api/series/${ctx.seriesId}/books/${ctx.bookId}/writer-characters/${body.id}/avatar`, {
            method: 'POST',
            body: form,
          })
        }
        await ctx.onOverlaySaved()
      }

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

  /**
   * Remove Loom's overlay — and only Loom's.
   *
   * The character survives in WriteAI with their traits, relationships and
   * chapter tags, and keeps appearing in the cast un-aged. Deleting the record
   * itself is the X at the top of this modal, which a book page does not
   * offer: it would strip them out of every writer-event that names them and
   * out of canon lookup.
   */
  async function clearBookData() {
    const ctx = bookContext
    if (!ctx) return
    try {
      await Promise.all([
        fetch(`/api/series/${ctx.seriesId}/writer-characters/${draft.id}`, { method: 'DELETE' }),
        fetch(`/api/series/${ctx.seriesId}/books/${ctx.bookId}/writer-characters/${draft.id}/avatar`, { method: 'DELETE' }),
      ])
      await ctx.onOverlaySaved()
      onClose()
    } catch {
      notify('error', "Couldn't clear this character's book data.")
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

  /**
   * What the "this book" portrait slot shows.
   *
   * Falls back to the MAIN portrait rather than to an empty camera icon,
   * because that is what the book will actually render: no per-book file means
   * the chain lands on WriteAI's photo. Showing a blank there suggested the
   * character had no portrait in this book, which was never true.
   *
   * It follows the main portrait live, so uploading one while creating a
   * character fills both slots at once — there is nothing to "also" set unless
   * you want this book to differ.
   */
  const mainPortraitSrc = characterPhotoHref(draft.photo_url)
  const bookPortraitSrc =
    bookPhotoPreview ??
    (clearBookPhoto ? mainPortraitSrc : bookContext?.overlay?.portraitUrl ?? mainPortraitSrc)

  if (!mounted) return null

  return createPortal(
    <div
      /* Centred over the CONTENT, not the window: the overlay is `fixed`, so
         without the sidebar's width as left padding the dialog sits visibly
         left of the page it belongs to. --author-sidebar comes from the author
         layout and follows the sidebar when it collapses. */
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4"
      style={{ paddingLeft: 'calc(var(--author-sidebar, 0px) + 1rem)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'New character' : `Editing ${character!.name}`}
        /* Three bands, not one scrolling box: a character with a family's worth
           of relationships and a book section overflows, and when the whole
           dialog scrolled, Save and the close X scrolled away with it. */
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-accent/20 bg-surface-raised shadow-2xl"
      >
        {/* Header — portrait, name and the close/delete control. Pinned. */}
        <div className="shrink-0 px-5 pb-3 pt-5">
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
            ) : !allowDelete ? null : confirmingDelete ? (
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

        {/* Narrative weight. Sticky with the name rather than scrolling away
            with the detail fields — it is what the cast list sorts by. */}
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
        </div>

        {/* Body — the only part that scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">

        {duplicate && (
          <p className="mt-2 text-[11px] text-red-500">
            A character called “{trimmedName}” already exists. Names still link records together, so
            they have to stay unique.
          </p>
        )}


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
        {/* ---------------------------------------------------------------
            LOOM'S HALF. Only rendered when this modal was opened from a book.

            Everything above belongs to WriteAI and is true of the character
            everywhere. Everything below belongs to Loom and is true of them in
            a BOOK — which is precisely what WriteAI has no field for, and why
            the two halves cannot simply be merged into one record.
            --------------------------------------------------------------- */}
        {bookContext && (
          <div className="mt-5 border-t border-accent/10 pt-4">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              In {bookContext.bookTitle}
            </h3>

            <div className="flex items-start gap-4">
              {/* Per-book portrait. The default portrait is the one at the top
                  of this modal — WriteAI's — and this overrides it for this
                  book only. Characters age across five books; one portrait for
                  the series is wrong. */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => bookPhotoRef.current?.click()}
                  title="Portrait for this book"
                  className="relative h-14 w-14 overflow-hidden rounded-full border border-accent/20 transition hover:border-accent"
                >
                  {bookPortraitSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bookPortraitSrc} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-surface-overlay">
                      <LuCamera size={14} className="text-ink-faint" />
                    </span>
                  )}
                </button>
                <span className="text-[9px] uppercase tracking-wider text-ink-faint">
                  {bookPhotoPreview || (bookContext.overlay?.hasBookAvatar && !clearBookPhoto)
                    ? 'this book'
                    : 'default'}
                </span>
                {(bookPhotoPreview || (bookContext.overlay?.hasBookAvatar && !clearBookPhoto)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBookPhoto(null)
                      setBookPhotoPreview(null)
                      setClearBookPhoto(true)
                    }}
                    className="text-[9px] text-ink-faint underline underline-offset-2 transition hover:text-ink"
                  >
                    use default
                  </button>
                )}
                <input
                  ref={bookPhotoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) setPendingBookPhoto(file)
                  }}
                />
              </div>

              <div className="flex-1 space-y-3">
                <div>
                  <label htmlFor="wc-book-age" className="mb-1 block text-[10px] uppercase tracking-widest text-ink-faint">
                    Age in this book
                  </label>
                  <input
                    id="wc-book-age"
                    value={bookAge}
                    onChange={e => setBookAge(e.target.value)}
                    placeholder="—"
                    className={`w-20 rounded-lg border bg-surface-overlay/40 px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-accent ${
                      ageInvalid ? 'border-red-500' : 'border-accent/20'
                    }`}
                  />
                  {ageInvalid && <p className="mt-1 text-[10px] text-red-500">Age must be a whole number</p>}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={starred}
                    onChange={e => setStarred(e.target.checked)}
                    className="accent-accent"
                  />
                  Primary character
                  <span className="text-[10px] text-ink-faint">(whole series)</span>
                </label>
              </div>
            </div>

            {/* Appearance range — series-wide, but edited here because a book
                page is where you notice it. */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {([
                ['Appears from', firstBookId, setFirstBookId, '— every book —'],
                ['Dies in', deathBookId, setDeathBookId, '— still alive —'],
                ['Last appears', lastBookId, setLastBookId, '— never leaves —'],
              ] as const).map(([label, value, setter, empty]) => (
                <div key={label}>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-ink-faint">{label}</label>
                  <select
                    value={value}
                    onChange={e => setter(e.target.value)}
                    aria-label={label}
                    className="w-full rounded-lg border border-accent/20 bg-surface-overlay/40 px-2 py-1.5 text-[11px] text-ink outline-none transition focus:border-accent"
                  >
                    <option value="">{empty}</option>
                    {[...bookContext.books].sort((a, b) => a.order - b.order).map(b => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] italic text-ink-faint">
              Dying marks them &ldquo;Deceased&rdquo; in later books — they still appear normally in the book chosen.
            </p>

            {/* Clears LOOM's data only. Deleting the character outright is the
                X at the top, and is not offered from a book page. */}
            {bookContext.overlay && (
              clearingBookData ? (
                <div className="mt-3 flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-muted">Clear this character&rsquo;s book data?</span>
                  <button
                    type="button"
                    onClick={() => void clearBookData()}
                    className="rounded bg-red-500/90 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-red-500"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearingBookData(false)}
                    className="text-[10px] text-ink-faint transition hover:text-ink"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setClearingBookData(true)}
                  title="Removes the ages, star and appearance range Loom holds. The character, their traits and their chapter tags stay."
                  className="mt-3 text-[10px] text-ink-faint underline underline-offset-2 transition hover:text-ink"
                >
                  Clear book data
                </button>
              )
            )}
          </div>
        )}

        </div>

        {/* Footer — pinned, so Save is reachable however tall the body gets. */}
        <div className="flex shrink-0 items-center gap-3 border-t border-accent/10 px-5 py-4">
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

      {pendingBookPhoto && (
        <PhotoCropDialog
          file={pendingBookPhoto}
          onCancel={() => setPendingBookPhoto(null)}
          onCropped={blob => {
            // Held, not uploaded: the per-book portrait is written on Save
            // with the rest of Loom's half. WriteAI's own portrait above
            // uploads immediately because WriteAI owns that file either way.
            setBookPhoto(blob)
            setBookPhotoPreview(URL.createObjectURL(blob))
            setClearBookPhoto(false)
            setPendingBookPhoto(null)
          }}
        />
      )}

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
