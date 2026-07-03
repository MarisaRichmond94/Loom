'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuUser, LuCheck, LuPencil, LuPlus, LuMusic, LuX, LuEye, LuStar, LuEyeOff, LuDownload, LuFileText } from 'react-icons/lu'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import BookSkeleton from '@/components/editor/BookSkeleton'
import ExportBookModal from '@/components/editor/ExportBookModal'
import { useCanonSave } from '@/components/editor/useCanonSave'
import { pinLabel } from '@/lib/pinLabel'
import PinnedAudio from '@/components/PinnedAudio'

type Stats = { chapterCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Book = { id: string; title: string; synopsis: string; coverPath: string | null; published: boolean; stats: Stats }
// Resolved-for-this-book shape returned by /api/series/[seriesId]/books/[bookId]/characters
type Character = {
  id: string
  name: string
  age: number | null
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  starred: boolean
  hasAvatar: boolean
  hasBookAvatar: boolean
  hasCanonicalAvatar: boolean
  hasOverride: boolean
  deceased: boolean
  hidden: boolean
}
type Soundtrack = {
  id: string
  title: string | null
  audioPath: string
  pinStart: number | null
  pinEnd: number | null
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  hasAlbumArt: boolean
}

async function cropImageToBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.92),
  )
}

export default function BookDetailPage() {
  const { seriesId, bookId } = useParams() as { seriesId: string; bookId: string }
  const router = useRouter()
  const { series, loadSeries } = useAuthor()
  const [book, setBook] = useState<Book | null>(null)
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Characters — list is resolved for THIS book (firstBookId filter + override merge)
  const [characters, setCharacters] = useState<Character[]>([])
  const [charModal, setCharModal] = useState<'create' | Character | null>(null)
  const [charName, setCharName] = useState('')
  const [charAge, setCharAge] = useState('')
  const [charFirstBookId, setCharFirstBookId] = useState<string>('')
  const [charDeathBookId, setCharDeathBookId] = useState<string>('')
  const [charLastBookId, setCharLastBookId] = useState<string>('')
  const [charStarred, setCharStarred] = useState(false)
  const [charImageSrc, setCharImageSrc] = useState<string | null>(null)
  const [charCrop, setCharCrop] = useState({ x: 0, y: 0 })
  const [charZoom, setCharZoom] = useState(1)
  const [charCroppedArea, setCharCroppedArea] = useState<Area | null>(null)
  const [savingChar, setSavingChar] = useState(false)
  const [charAvatarTs, setCharAvatarTs] = useState(0)
  const charFileInputRef = useRef<HTMLInputElement>(null)
  const isInitialBookLoadRef = useRef(true)
  // Manuscript export + front matter (title page / copyright pages the
  // writer keeps in Pages; spliced ahead of Chapter 1 on export).
  const [showExportModal, setShowExportModal] = useState(false)
  const [frontMatter, setFrontMatter] = useState<{ originalName: string; uploadedAt: string } | null>(null)
  const [frontMatterBusy, setFrontMatterBusy] = useState(false)
  const [frontMatterError, setFrontMatterError] = useState<string | null>(null)
  const frontMatterInputRef = useRef<HTMLInputElement>(null)
  // Soundtracks aggregated across every chapter in this book.
  const [soundtracks, setSoundtracks] = useState<Soundtrack[]>([])
  // Cache-buster keyed by song id so a fresh upload re-renders the thumbnail
  // without flushing the whole list. Updated when album art changes.
  const [albumArtTs, setAlbumArtTs] = useState<Record<string, number>>({})
  const albumArtFileInputRef = useRef<HTMLInputElement>(null)
  const albumArtTargetIdRef = useRef<string | null>(null)

  // ⌥⇧E — save the canon manuscript to the book's folder on disk
  // (Settings → Export configures where).
  const { saveCanon } = useCanonSave(seriesId)
  const saveCanonRef = useRef(saveCanon)
  saveCanonRef.current = saveCanon
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.code !== 'KeyE') return
      e.preventDefault()
      saveCanonRef.current(bookId)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [bookId])

  const loadBook = useCallback(async () => {
    const start = Date.now()
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}`)
    if (!res.ok) return
    const data = await res.json()
    if (isInitialBookLoadRef.current) {
      await ensureMinDuration(start)
      isInitialBookLoadRef.current = false
    }
    setBook({
      ...data,
      coverPath: data.coverPath ? `${data.coverPath}?t=${Date.now()}` : null,
    })
    setTitle(data.title)
    setSynopsis(data.synopsis ?? '')
  }, [seriesId, bookId])

  const loadCharacters = useCallback(async () => {
    // Book-scoped: resolves overrides + filters by firstBookId.
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/characters`)
    if (res.ok) setCharacters(await res.json())
  }, [seriesId, bookId])

  // Returns the avatar URL for a character resolved in this book context.
  // Prefers the per-book file, falls back to the canonical, else null.
  function avatarUrlFor(c: Character | null, ts: number): string | null {
    if (!c) return null
    if (c.hasBookAvatar) return `/characters/${c.id}-${bookId}.jpg?t=${ts}`
    if (c.hasCanonicalAvatar) return `/characters/${c.id}.jpg?t=${ts}`
    return null
  }

  const loadSoundtracks = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/soundtracks`)
    if (res.ok) setSoundtracks(await res.json())
  }, [seriesId, bookId])

  function openAlbumArtPicker(soundtrackId: string) {
    albumArtTargetIdRef.current = soundtrackId
    albumArtFileInputRef.current?.click()
  }

  async function handleAlbumArtChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const id = albumArtTargetIdRef.current
    if (!file || !id) { e.target.value = ''; return }
    const form = new FormData()
    form.append('art', file)
    const res = await fetch(`/api/blocks/${id}/album-art`, { method: 'POST', body: form })
    if (res.ok) {
      setSoundtracks(prev => prev.map(s => s.id === id ? { ...s, hasAlbumArt: true } : s))
      setAlbumArtTs(prev => ({ ...prev, [id]: Date.now() }))
    }
    albumArtTargetIdRef.current = null
    e.target.value = ''
  }

  async function removeAlbumArt(soundtrackId: string) {
    const res = await fetch(`/api/blocks/${soundtrackId}/album-art`, { method: 'DELETE' })
    if (res.ok) {
      setSoundtracks(prev => prev.map(s => s.id === soundtrackId ? { ...s, hasAlbumArt: false } : s))
    }
  }

  const loadFrontMatter = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/front-matter`)
    if (res.ok) setFrontMatter((await res.json()).frontMatter)
  }, [seriesId, bookId])

  async function handleFrontMatterChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFrontMatterBusy(true)
    setFrontMatterError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/front-matter`, { method: 'POST', body: form })
      const payload = await res.json().catch(() => null)
      if (res.ok) setFrontMatter(payload.frontMatter)
      else setFrontMatterError(payload?.error ?? 'Upload failed')
    } finally {
      setFrontMatterBusy(false)
    }
  }

  async function removeFrontMatter() {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/front-matter`, { method: 'DELETE' })
    if (res.ok) setFrontMatter(null)
  }

  useEffect(() => { loadSoundtracks() }, [loadSoundtracks])
  useEffect(() => { loadBook() }, [loadBook])
  useEffect(() => { loadCharacters() }, [loadCharacters])
  useEffect(() => { loadFrontMatter() }, [loadFrontMatter])

  function openCreateModal() {
    setCharName('')
    setCharAge('')
    // New characters created from a book default to "first appears in" THIS book
    // so they don't leak back into earlier books in the series.
    setCharFirstBookId(bookId)
    setCharDeathBookId('')
    setCharLastBookId('')
    setCharStarred(false)
    setCharImageSrc(null)
    setCharModal('create')
  }

  function openEditModal(c: Character) {
    setCharName(c.name)
    setCharAge(c.age != null ? String(c.age) : '')
    setCharFirstBookId(c.firstBookId ?? '')
    setCharDeathBookId(c.deathBookId ?? '')
    setCharLastBookId(c.lastBookId ?? '')
    setCharStarred(c.starred)
    setCharImageSrc(null)
    setCharAvatarTs(Date.now())
    setCharModal(c)
  }

  function closeCharModal() {
    setCharModal(null)
    setCharImageSrc(null)
    setCharCrop({ x: 0, y: 0 })
    setCharZoom(1)
  }

  async function saveCharacter() {
    if (!charName.trim()) return
    if (charAge.trim() !== '' && isNaN(Number(charAge))) return
    setSavingChar(true)
    try {
      const age = charAge.trim() !== '' ? Number(charAge) : null
      const firstBookId = charFirstBookId || null
      const deathBookId = charDeathBookId || null
      const lastBookId = charLastBookId || null
      let characterId: string

      if (charModal === 'create') {
        // Create: name + age + firstBookId + deathBookId + lastBookId +
        // starred all canonical. Any uploaded photo also becomes the
        // canonical avatar so future books inherit it.
        const res = await fetch(`/api/series/${seriesId}/characters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: charName.trim(), age, firstBookId, deathBookId, lastBookId, starred: charStarred }),
        })
        if (!res.ok) return
        const created = await res.json() as { id: string }
        characterId = created.id

        if (charImageSrc && charCroppedArea) {
          const blob = await cropImageToBlob(charImageSrc, charCroppedArea)
          const form = new FormData()
          form.append('avatar', blob, 'avatar.jpg')
          await fetch(`/api/series/${seriesId}/characters/${characterId}/avatar`, { method: 'POST', body: form })
        }
      } else {
        // Edit on a book page: name + firstBookId are canonical, age and avatar
        // get applied as a per-book override so other books are unaffected.
        const existing = charModal as Character
        characterId = existing.id

        // Canonical patch (name + firstBookId + deathBookId + lastBookId + starred)
        const nameChanged = charName.trim() !== existing.name
        const firstBookChanged = (firstBookId ?? null) !== (existing.firstBookId ?? null)
        const deathBookChanged = (deathBookId ?? null) !== (existing.deathBookId ?? null)
        const lastBookChanged = (lastBookId ?? null) !== (existing.lastBookId ?? null)
        const starredChanged = charStarred !== existing.starred
        if (nameChanged || firstBookChanged || deathBookChanged || lastBookChanged || starredChanged) {
          await fetch(`/api/series/${seriesId}/characters/${characterId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(nameChanged ? { name: charName.trim() } : {}),
              ...(firstBookChanged ? { firstBookId } : {}),
              ...(deathBookChanged ? { deathBookId } : {}),
              ...(lastBookChanged ? { lastBookId } : {}),
              ...(starredChanged ? { starred: charStarred } : {}),
            }),
          })
        }

        // Book-specific override (age)
        await fetch(`/api/series/${seriesId}/books/${bookId}/characters/${characterId}/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ age }),
        })

        // Book-specific avatar upload
        if (charImageSrc && charCroppedArea) {
          const blob = await cropImageToBlob(charImageSrc, charCroppedArea)
          const form = new FormData()
          form.append('avatar', blob, 'avatar.jpg')
          await fetch(`/api/series/${seriesId}/books/${bookId}/characters/${characterId}/avatar`, { method: 'POST', body: form })
        }
      }
      await loadCharacters()
      setCharAvatarTs(Date.now())
      closeCharModal()
    } finally {
      setSavingChar(false)
    }
  }

  async function deleteCharacter(id: string) {
    await fetch(`/api/series/${seriesId}/characters/${id}`, { method: 'DELETE' })
    await loadCharacters()
    closeCharModal()
  }

  // Quick-toggle handlers — used by the hover buttons on each character
  // card so the writer doesn't have to open the modal for these common
  // ops. Both PATCH the canonical row and refetch the resolved list so
  // the dependent fields (`hidden`, `starred`) come back consistent.
  async function toggleStarred(c: Character) {
    await fetch(`/api/series/${seriesId}/characters/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: !c.starred }),
    })
    await loadCharacters()
  }

  async function toggleHidden(c: Character) {
    // c.hidden being true means `lastBookId` already points at an earlier
    // book; unhiding clears it. From a not-hidden card, hide sets
    // lastBookId to THIS book — the character keeps appearing here and
    // disappears starting in the next book.
    const nextLastBookId = c.hidden ? null : bookId
    await fetch(`/api/series/${seriesId}/characters/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastBookId: nextLastBookId }),
    })
    await loadCharacters()
  }

  // Wipes the per-book override row + per-book avatar for the character open
  // in the modal; the book grid then snaps back to the canonical character.
  async function resetOverridesForBook(characterId: string) {
    await fetch(`/api/series/${seriesId}/books/${bookId}/characters/${characterId}/override`, {
      method: 'DELETE',
    })
    await loadCharacters()
    setCharAvatarTs(Date.now())
    closeCharModal()
  }

  async function patchBook(data: object) {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    loadSeries()
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('cover', file)
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/cover`, {
      method: 'POST',
      body: form,
    })
    if (res.ok) {
      const { coverPath } = await res.json()
      setBook(prev => prev ? { ...prev, coverPath: `${coverPath}?t=${Date.now()}` } : null)
    }
    e.target.value = ''
  }

  async function handleDelete() {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, { method: 'DELETE' })
    await loadSeries()
    router.push(`/author/${seriesId}`)
  }

  if (!book) return <BookSkeleton />

  async function togglePublished() {
    if (!book) return
    const next = !book.published
    setBook({ ...book, published: next })
    await fetch(`/api/series/${seriesId}/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: next }),
    })
  }

  return (
    <>
      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* Preview + Publish controls sit in their own row above the cover
            so they don't crowd the title or get hidden behind the synopsis. */}
        <div className="flex items-center justify-end gap-2 mb-6">
          <button
            onClick={togglePublished}
            className={`px-3 py-1.5 rounded text-xs font-medium transition border flex items-center gap-1.5 ${
              book.published
                ? 'bg-accent/10 text-ink border-accent/30 hover:bg-accent/15'
                : 'bg-surface-overlay text-ink-muted border-accent/20 hover:text-ink'
            }`}
            title={book.published ? 'Click to revert to draft' : 'Click to publish to readers'}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${book.published ? 'bg-accent' : 'bg-ink-faint'}`} />
            {book.published ? 'Published' : 'Draft'}
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            title="Export this book as a Pages manuscript"
            className="px-3 py-1.5 rounded text-xs bg-surface-overlay text-ink-muted border border-accent/20 font-medium hover:text-ink transition flex items-center gap-1.5"
          >
            <LuDownload size={12} /> Export
          </button>
          <a
            href={`/preview/book/${bookId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition flex items-center gap-1.5"
          >
            <LuEye size={12} /> Preview
          </a>
        </div>
        <div className="flex gap-8 mb-8 items-stretch">
          {/* Cover */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-44 rounded-lg border-2 border-dashed border-accent/20 flex items-center justify-center cursor-pointer hover:border-accent/50 transition overflow-hidden shrink-0 bg-surface-raised self-stretch"
          >
            {book.coverPath ? (
              <img src={book.coverPath} alt="Book cover" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-ink-faint text-center px-2">Click to upload cover</span>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
          <input ref={albumArtFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAlbumArtChange} />

          {/* Title + Synopsis */}
          <div className="flex-1 flex flex-col gap-4">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => patchBook({ title })}
              className="w-full bg-surface-raised border border-accent/20 rounded-lg px-4 py-3 text-xl font-semibold text-ink outline-none focus:border-accent"
              placeholder="Book title"
            />
            <textarea
              value={synopsis}
              onChange={e => setSynopsis(e.target.value)}
              onBlur={() => patchBook({ synopsis })}
              rows={7}
              placeholder="Write your synopsis here…"
              className="w-full flex-1 bg-surface-raised border border-accent/20 rounded-lg px-4 py-3 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Chapter(s)', value: book.stats.chapterCount },
            { label: 'Word(s)', value: book.stats.wordCount.toLocaleString() },
            { label: 'POV(s)', value: book.stats.uniquePovs },
            { label: 'Choice(s)', value: book.stats.choiceCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-raised border border-accent/10 rounded-lg px-4 py-5 flex flex-col items-center gap-1">
              <span className="text-2xl font-bold text-ink">{value}</span>
              <span className="text-xs text-ink-faint uppercase tracking-widest">{label}</span>
            </div>
          ))}
        </div>

        {/* Characters */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-ink">Character(s)</h2>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
            >
              <LuPlus size={12} /> Add Character
            </button>
          </div>
          {characters.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20" style={{ height: 300 }}>
              <p className="text-sm text-ink-faint italic text-center px-8">No characters yet. Add one to start tagging appearances in your chapters.</p>
            </div>
          ) : (() => {
              const povNames = new Set(series.books.flatMap(b => b.chapters.map(ch => ch.pov)).filter(Boolean) as string[])
              return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8, minHeight: 300, alignContent: 'start' }}>
              {characters.map(c => {
                const isPov = povNames.has(c.name)
                return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditModal(c)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditModal(c) } }}
                  className={`group/charcard relative flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-raised border transition h-[146px] w-full cursor-pointer ${c.hidden ? 'opacity-60 ' : ''}${isPov ? 'border-accent hover:border-accent/70' : 'border-accent/10 hover:border-accent/30'}`}
                >
                  {/* Quick toggles. Active state stays visible permanently;
                      idle state fades in on card hover. stopPropagation so
                      clicking these doesn't open the edit modal. */}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggleHidden(c) }}
                    title={c.hidden ? 'Make visible to readers from this book on' : 'Hide from readers in later books'}
                    className={`absolute top-1.5 left-1.5 p-0.5 rounded hover:bg-accent/20 transition ${c.hidden ? 'opacity-100' : 'opacity-0 group-hover/charcard:opacity-80'}`}
                  >
                    <LuEyeOff size={12} className="text-ink-faint" />
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggleStarred(c) }}
                    title={c.starred ? 'Unstar (no longer primary)' : 'Star as primary character'}
                    className={`absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-accent/20 transition ${c.starred ? 'opacity-100' : 'opacity-0 group-hover/charcard:opacity-80'}`}
                  >
                    <LuStar size={12} className={c.starred ? 'fill-accent text-accent' : 'text-ink-faint'} />
                  </button>
                  <div className={`w-20 h-20 rounded-full overflow-hidden border-2 bg-surface-overlay flex items-center justify-center shrink-0 ${isPov ? 'border-accent' : 'border-accent/20'}`}>
                    {(() => {
                      const url = avatarUrlFor(c, charAvatarTs)
                      return url
                        ? <img src={url} alt={c.name} className="w-full h-full object-cover" />
                        : <LuUser size={32} className="text-ink-faint" />
                    })()}
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-ink truncate w-full">{c.name}</p>
                    {c.hidden
                      ? <p className="text-[10px] uppercase tracking-widest text-ink-faint italic">Hidden</p>
                      : c.deceased
                        ? <p className="text-[10px] uppercase tracking-widest text-ink-faint italic">Deceased</p>
                        : c.age != null && <p className="text-xs text-ink-faint">Age {c.age}</p>}
                  </div>
                </div>
              )})}
            </div>
              )
          })()}
        </div>

        {/* Soundtrack — every chapter's soundtrack blocks, in story order */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink mb-2">Soundtrack</h2>
          {soundtracks.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20" style={{ height: 120 }}>
              <p className="text-sm text-ink-faint italic text-center px-8">
                No soundtracks yet. Add a soundtrack block in any chapter to see it here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {soundtracks.map((s, idx) => {
                const label = pinLabel(s.pinStart, s.pinEnd)
                const chapterDisplay = s.chapterTitle?.trim() || `Chapter ${s.chapterOrder}`
                const artUrl = s.hasAlbumArt ? `/music/${s.id}-art.jpg?t=${albumArtTs[s.id] ?? 0}` : null
                return (
                  <div key={s.id} className="px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-faint shrink-0 w-6 text-right">{idx + 1}</span>
                      <button
                        onClick={() => openAlbumArtPicker(s.id)}
                        title={artUrl ? 'Replace album art' : 'Upload album art'}
                        className={`group/art relative shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center transition ${
                          artUrl
                            ? 'border border-accent/10 hover:border-accent/40'
                            : 'border border-dashed border-accent/30 hover:border-accent/60 bg-surface-overlay'
                        }`}
                      >
                        {artUrl
                          ? <img src={artUrl} alt="" className="w-full h-full object-cover" />
                          : <LuMusic size={14} className="text-accent" />}
                        {artUrl && (
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={e => { e.stopPropagation(); removeAlbumArt(s.id) }}
                            title="Remove album art"
                            className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/60 text-white opacity-0 group-hover/art:opacity-100 transition flex items-center justify-center hover:bg-choice-kill/80 cursor-pointer"
                          >
                            <LuX size={10} />
                          </span>
                        )}
                      </button>
                      <div className="shrink-0 min-w-0 max-w-[40%]">
                        <p className="text-sm text-ink truncate">{s.title?.trim() || '(untitled)'}</p>
                        <p className="text-xs text-ink-faint italic truncate">{chapterDisplay}</p>
                      </div>
                      <PinnedAudio
                        src={s.audioPath}
                        pinStart={s.pinStart}
                        pinEnd={s.pinEnd}
                        className="flex-1 min-w-0"
                      />
                    </div>
                    {label && (
                      <p className="text-xs text-ink-faint italic mt-2 pl-[3.75rem]">{label}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Front matter — spliced ahead of Chapter 1 in manuscript exports */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink mb-2">Front Matter</h2>
          <div className="px-4 py-3 rounded-lg bg-surface-raised border border-accent/10 flex items-center gap-3">
            <input
              ref={frontMatterInputRef}
              type="file"
              accept=".pages,.docx"
              className="hidden"
              onChange={handleFrontMatterChange}
            />
            <LuFileText size={16} className="text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              {frontMatter ? (
                <>
                  <p className="text-sm text-ink truncate">{frontMatter.originalName}</p>
                  <p className="text-xs text-ink-faint">
                    Uploaded {new Date(frontMatter.uploadedAt).toLocaleDateString()} — included at the start of every export.
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-faint">
                  Title page, copyright, dedication… Upload a <span className="font-mono">.pages</span> or{' '}
                  <span className="font-mono">.docx</span> and exports will open with it.
                </p>
              )}
              {frontMatterError && <p className="text-xs text-choice-kill mt-0.5">{frontMatterError}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => frontMatterInputRef.current?.click()}
                disabled={frontMatterBusy}
                className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50"
              >
                {frontMatterBusy ? 'Uploading…' : frontMatter ? 'Replace' : 'Upload'}
              </button>
              {frontMatter && !frontMatterBusy && (
                <button
                  onClick={removeFrontMatter}
                  className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-choice-kill transition"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Delete */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-5 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition"
          >
            Delete Book
          </button>
        </div>
      </div>

      {/* Character create/edit modal. Three-band layout so tall content
          (cropper + all the per-book selectors) doesn't push the action
          row off-screen on shorter viewports:
            - Header band: title + close + avatar + name (always visible)
            - Middle band: scrollable fields
            - Footer band: Delete / Cancel / Save (always reachable) */}
      {charModal !== null && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 6vh)', paddingLeft: '14rem' }}
          onClick={closeCharModal}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl max-w-md w-full mx-8 shadow-2xl relative flex flex-col max-h-[calc(100vh-12vh-60px)]"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={closeCharModal} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none z-10">✕</button>

            {/* Header: title + avatar + name. shrink-0 keeps it pinned. */}
            <div className="shrink-0 px-8 pt-8 pb-4 border-b border-accent/10">
              <h2 className="text-base font-bold text-ink mb-6 pr-6">
                {charModal === 'create' ? 'New Character' : `Edit "${(charModal as Character).name}"`}
              </h2>

              {/* Avatar */}
              <div className="flex flex-col items-center mb-4">
                {charImageSrc ? (
                  <div className="relative w-full h-52 rounded-xl overflow-hidden bg-black">
                    <Cropper
                      image={charImageSrc}
                      crop={charCrop}
                      zoom={charZoom}
                      aspect={1}
                      cropShape="round"
                      onCropChange={setCharCrop}
                      onZoomChange={setCharZoom}
                      onCropComplete={(_, pixels) => setCharCroppedArea(pixels)}
                    />
                  </div>
                ) : (
                  <div
                    onClick={() => charFileInputRef.current?.click()}
                    className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-accent/20 bg-surface-overlay flex items-center justify-center cursor-pointer group"
                  >
                    {(() => {
                      if (charModal === 'create') return <LuUser size={32} className="text-ink-faint" />
                      const url = avatarUrlFor(charModal as Character, charAvatarTs)
                      return url
                        ? <img src={url} alt="" className="w-full h-full object-cover" />
                        : <LuUser size={32} className="text-ink-faint" />
                    })()}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                      <LuPencil size={16} className="text-white" />
                    </div>
                  </div>
                )}
                <input
                  ref={charFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => setCharImageSrc(reader.result as string)
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">Name</label>
                <input
                  value={charName}
                  onChange={e => setCharName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCharacter()}
                  placeholder="Character name"
                  className="w-full bg-surface-overlay border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Scrollable middle: everything below the name field. */}
            <div className="flex-1 min-h-0 overflow-y-auto px-8 py-4">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">
                    Age <span className="normal-case">(optional)</span>
                    {charModal !== 'create' && (charModal as Character).hasOverride && (
                      <span className="ml-2 normal-case text-ink-muted italic">overridden in this book</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={charAge}
                    onChange={e => setCharAge(e.target.value)}
                    placeholder="—"
                    className={`w-24 bg-surface-overlay border rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent ${charAge.trim() !== '' && isNaN(Number(charAge)) ? 'border-choice-kill' : 'border-accent/20'}`}
                  />
                  {charAge.trim() !== '' && isNaN(Number(charAge)) && (
                    <p className="text-xs text-choice-kill mt-1">Age must be a number</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">Appears starting in</label>
                  <select
                    value={charFirstBookId}
                    onChange={e => setCharFirstBookId(e.target.value)}
                    className="w-full bg-surface-overlay border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="">— every book —</option>
                    {[...series.books].sort((a, b) => a.order - b.order).map(b => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">Dies in</label>
                  <select
                    value={charDeathBookId}
                    onChange={e => setCharDeathBookId(e.target.value)}
                    className="w-full bg-surface-overlay border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="">— still alive —</option>
                    {[...series.books].sort((a, b) => a.order - b.order).map(b => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink-faint italic mt-1">
                    Marks them &ldquo;Deceased&rdquo; in every later book. They still appear normally in the chosen book.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">Last appears in</label>
                  <select
                    value={charLastBookId}
                    onChange={e => setCharLastBookId(e.target.value)}
                    className="w-full bg-surface-overlay border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="">— appears in every book —</option>
                    {[...series.books].sort((a, b) => a.order - b.order).map(b => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink-faint italic mt-1">
                    Hidden from readers in every later book. You still see them
                    here so you can un-hide them.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={charStarred}
                    onChange={e => setCharStarred(e.target.checked)}
                    className="accent-accent"
                  />
                  <span>Primary character (starred)</span>
                </label>
                {charModal !== 'create' && (charModal as Character).hasOverride && (
                  <button
                    type="button"
                    onClick={() => resetOverridesForBook((charModal as Character).id)}
                    className="self-start text-xs text-ink-muted hover:text-ink underline underline-offset-2 transition"
                  >
                    Reset overrides for this book
                  </button>
                )}
              </div>
            </div>

            {/* Footer band — buttons stay reachable no matter how tall the
                scrollable area gets. */}
            <div className="shrink-0 px-8 py-4 border-t border-accent/10 flex items-center justify-between">
              {charModal !== 'create' ? (
                <button
                  onClick={() => deleteCharacter((charModal as Character).id)}
                  className="px-4 py-2 rounded-lg text-sm text-choice-kill hover:bg-choice-kill/10 transition"
                >
                  Delete
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={closeCharModal} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">Cancel</button>
                <button
                  onClick={saveCharacter}
                  disabled={savingChar || !charName.trim() || (charAge.trim() !== '' && isNaN(Number(charAge)))}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                >
                  <LuCheck size={14} /> {savingChar ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <ExportBookModal
          seriesId={seriesId}
          bookId={bookId}
          bookTitle={book.title}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-ink mb-3 pr-6">
              Are you sure you want to delete "{book.title}"?
            </h2>
            <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
              Deleting this book is permanent and cannot be undone. All of its chapters, written content,
              and choices will be removed. Any story branches in later books that depended on choices
              made here will fall back to their default text.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
