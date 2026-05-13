'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LuMoon, LuSun, LuUser, LuX, LuCheck, LuPencil, LuPlus } from 'react-icons/lu'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

type Stats = { chapterCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Book = { id: string; title: string; synopsis: string; coverPath: string | null; stats: Stats }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Character = { id: string; name: string; age: number | null; hasAvatar: boolean }
type Series = {
  id: string; title: string
  books: { id: string; title: string; order: number; chapters: { id: string; title: string; order: number }[] }[]
  variables: Variable[]
}
type ChoiceQuestion = { id: string; prompt: string; chapterId: string; chapterTitle: string; bookTitle: string }

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
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.92)
  )
}

export default function BookDetailPage() {
  const { seriesId, bookId } = useParams() as { seriesId: string; bookId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [choiceQuestions, setChoiceQuestions] = useState<ChoiceQuestion[]>([])
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [lightMode, setLightMode] = useState(() => typeof window !== 'undefined' && localStorage.getItem('loom-light-mode') === 'true')
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

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  const loadSeries = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

  const loadChoices = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/choices?upToBookId=${bookId}`)
    if (res.ok) setChoiceQuestions(await res.json())
  }, [seriesId, bookId])

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

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadBook() }, [loadBook])
  useEffect(() => { loadChoices() }, [loadChoices])
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
        saved = await res.json()
      } else {
        const res = await fetch(`/api/series/${seriesId}/characters/${(charModal as Character).id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: charName.trim(), age }),
        })
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
      // Append cache-buster so the browser fetches the new image even if path is the same
      setBook(prev => prev ? { ...prev, coverPath: `${coverPath}?t=${Date.now()}` } : null)
    }
    // Reset input so re-uploading the same file triggers onChange again
    e.target.value = ''
  }

  async function handleDelete() {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, { method: 'DELETE' })
    router.push(`/author/${seriesId}`)
  }

  async function addBook(t: string) {
    await fetch(`/api/series/${seriesId}/books`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) })
    loadSeries()
  }
  async function addChapter(bId: string, t: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${bId}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) })
    const c = await res.json()
    loadSeries()
    router.push(`/author/${seriesId}/chapter/${c.id}`)
  }

  async function insertChapter(bookId: string, title: string, atOrder: number) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, insertAtOrder: atOrder }),
    })
    const c = await res.json()
    loadSeries()
    router.push(`/author/${seriesId}/chapter/${c.id}`)
  }
  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, defaultValue }) })
    loadSeries()
  }
  async function updateVariable(id: string, name: string, type: string) {
    await fetch(`/api/variables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type }) })
    loadSeries()
  }
  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    loadSeries()
  }

  if (!series || !book) return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">Loading…</div>
  )

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <span className="text-ink-faint self-center">›</span>
        <Link href={`/author/${seriesId}`} className="text-ink-muted hover:text-ink self-center">{series.title}</Link>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink self-center">{book.title}</span>
        <div className="ml-auto flex items-center gap-2">
          <Greeting />
          <button
            role="switch"
            aria-checked={lightMode}
            onClick={toggleLightMode}
            title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
          >
            <LuMoon size={13} />
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
            </span>
            <LuSun size={13} />
          </button>
          <AvatarButton />
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-surface-raised border-r border-accent/10 flex flex-col overflow-hidden">
          <div className="flex flex-col min-h-0 max-h-[50%] p-4">
            <OutlineTree seriesId={seriesId} books={series.books} onAddBook={addBook} onAddChapter={addChapter} onInsertChapter={insertChapter} />
          </div>
          <div className="flex flex-col min-h-0 max-h-[25%] p-4 pt-3 border-t border-accent/10">
            <ChoicesPanel seriesId={seriesId} questions={choiceQuestions} />
          </div>
          <div className="flex flex-col min-h-0 max-h-[25%] p-4 pt-3 border-t border-accent/10">
            <VariablesPanel variables={series.variables} onAdd={addVariable} onUpdate={updateVariable} onDelete={deleteVariable} />
          </div>
        </aside>

        <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
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
            <div className="mb-2">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-ink">Characters</h2>
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
              ) : (
                <div className="flex flex-wrap gap-4">
                  {characters.map(c => (
                    <button
                      key={c.id}
                      onClick={() => openEditModal(c)}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-raised border border-accent/10 hover:border-accent/30 transition w-24"
                    >
                      <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-accent/20 bg-surface-overlay flex items-center justify-center shrink-0">
                        {c.hasAvatar
                          ? <img src={`/characters/${c.id}.jpg?t=${charAvatarTs}`} alt={c.name} className="w-full h-full object-cover" />
                          : <LuUser size={22} className="text-ink-faint" />
                        }
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-ink truncate w-full">{c.name}</p>
                        {c.age != null && <p className="text-xs text-ink-faint">Age {c.age}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
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

        </main>
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
                <div className="relative w-full h-52 rounded-xl overflow-hidden bg-black mb-3">
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
                <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-accent/20 bg-surface-overlay flex items-center justify-center mb-3">
                  {charModal !== 'create' && (charModal as Character).hasAvatar
                    ? <img src={`/characters/${(charModal as Character).id}.jpg?t=${charAvatarTs}`} alt="" className="w-full h-full object-cover" />
                    : <LuUser size={32} className="text-ink-faint" />
                  }
                </div>
              )}
              <button
                onClick={() => charFileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
              >
                <LuPencil size={12} /> {charImageSrc ? 'Choose different photo' : 'Upload photo'}
              </button>
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
                  type="number"
                  value={charAge}
                  onChange={e => setCharAge(e.target.value)}
                  placeholder="—"
                  min={0}
                  className="w-24 bg-surface-overlay border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
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
                  disabled={savingChar || !charName.trim()}
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
    </div>
  )
}
