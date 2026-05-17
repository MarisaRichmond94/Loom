'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuUser, LuCheck, LuPencil, LuPlus } from 'react-icons/lu'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { useAuthor } from '@/lib/authorContext'

type Stats = { chapterCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Book = { id: string; title: string; synopsis: string; coverPath: string | null; stats: Stats }
type Character = { id: string; name: string; age: number | null; hasAvatar: boolean }

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
  // Characters
  const [characters, setCharacters] = useState<Character[]>([])
  const [charModal, setCharModal] = useState<'create' | Character | null>(null)
  const [charName, setCharName] = useState('')
  const [charAge, setCharAge] = useState('')
  const [charImageSrc, setCharImageSrc] = useState<string | null>(null)
  const [charCrop, setCharCrop] = useState({ x: 0, y: 0 })
  const [charZoom, setCharZoom] = useState(1)
  const [charCroppedArea, setCharCroppedArea] = useState<Area | null>(null)
  const [savingChar, setSavingChar] = useState(false)
  const [charAvatarTs, setCharAvatarTs] = useState(0)
  const charFileInputRef = useRef<HTMLInputElement>(null)

  const loadBook = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}`)
    if (res.ok) {
      const data = await res.json()
      setBook({
        ...data,
        coverPath: data.coverPath ? `${data.coverPath}?t=${Date.now()}` : null,
      })
      setTitle(data.title)
      setSynopsis(data.synopsis ?? '')
    }
  }, [seriesId, bookId])

  const loadCharacters = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/characters`)
    if (res.ok) setCharacters(await res.json())
  }, [seriesId])

  useEffect(() => { loadBook() }, [loadBook])
  useEffect(() => { loadCharacters() }, [loadCharacters])

  function openCreateModal() {
    setCharName('')
    setCharAge('')
    setCharImageSrc(null)
    setCharModal('create')
  }

  function openEditModal(c: Character) {
    setCharName(c.name)
    setCharAge(c.age != null ? String(c.age) : '')
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
      let saved: Character
      if (charModal === 'create') {
        const res = await fetch(`/api/series/${seriesId}/characters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: charName.trim(), age }),
        })
        if (!res.ok) return
        saved = await res.json()
      } else {
        const res = await fetch(`/api/series/${seriesId}/characters/${(charModal as Character).id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: charName.trim(), age }),
        })
        if (!res.ok) return
        saved = await res.json()
      }
      if (charImageSrc && charCroppedArea) {
        const blob = await cropImageToBlob(charImageSrc, charCroppedArea)
        const form = new FormData()
        form.append('avatar', blob, 'avatar.jpg')
        await fetch(`/api/series/${seriesId}/characters/${saved.id}/avatar`, { method: 'POST', body: form })
        saved = { ...saved, hasAvatar: true }
      }
      await loadCharacters()
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

  if (!book) return (
    <div className="flex items-center justify-center text-ink-faint text-sm py-16">Loading…</div>
  )

  return (
    <>
      <div className="max-w-3xl mx-auto px-8 py-8">
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
                <button
                  key={c.id}
                  onClick={() => openEditModal(c)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-raised border transition h-[146px] w-full ${isPov ? 'border-accent hover:border-accent/70' : 'border-accent/10 hover:border-accent/30'}`}
                >
                  <div className={`w-20 h-20 rounded-full overflow-hidden border-2 bg-surface-overlay flex items-center justify-center shrink-0 ${isPov ? 'border-accent' : 'border-accent/20'}`}>
                    {c.hasAvatar
                      ? <img src={`/characters/${c.id}.jpg?t=${charAvatarTs}`} alt={c.name} className="w-full h-full object-cover" />
                      : <LuUser size={32} className="text-ink-faint" />
                    }
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-ink truncate w-full">{c.name}</p>
                    {c.age != null && <p className="text-xs text-ink-faint">Age {c.age}</p>}
                  </div>
                </button>
              )})}
            </div>
              )
          })()}
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

      {/* Character create/edit modal */}
      {charModal !== null && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 6vh)', paddingLeft: '14rem' }}
          onClick={closeCharModal}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-md w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={closeCharModal} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">✕</button>
            <h2 className="text-base font-bold text-ink mb-6 pr-6">
              {charModal === 'create' ? 'New Character' : `Edit "${(charModal as Character).name}"`}
            </h2>

            {/* Avatar */}
            <div className="flex flex-col items-center mb-6">
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
                  {charModal !== 'create' && (charModal as Character).hasAvatar
                    ? <img src={`/characters/${(charModal as Character).id}.jpg?t=${charAvatarTs}`} alt="" className="w-full h-full object-cover" />
                    : <LuUser size={32} className="text-ink-faint" />
                  }
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

            {/* Fields */}
            <div className="flex flex-col gap-4 mb-6">
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
              <div>
                <label className="block text-xs text-ink-faint mb-1 uppercase tracking-widest">Age <span className="normal-case">(optional)</span></label>
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
            </div>

            <div className="flex items-center justify-between">
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
