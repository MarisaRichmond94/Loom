'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuUser, LuCheck, LuPlus, LuMusic, LuX, LuEye, LuStar, LuEyeOff, LuDownload, LuFileText, LuSave, LuDatabaseBackup } from 'react-icons/lu'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import BookSkeleton from '@/components/editor/BookSkeleton'
import dynamic from 'next/dynamic'

// Only rendered after "Export book…" is clicked — load its chunk then, not
// with the page.
const ExportBookModal = dynamic(() => import('@/components/editor/ExportBookModal'), { ssr: false })
import { useCanonSave } from '@/components/editor/useCanonSave'
import { pinLabel } from '@/lib/pinLabel'
import PinnedAudio from '@/components/PinnedAudio'
import SectionTabs from '@/components/SectionTabs'
// Loaded when the Outline tab is first opened, not with the page — it pulls in
// the outline renderer for a section most page visits never look at.
const OutlineSection = dynamic(() => import('@/components/OutlineSection'), { ssr: false })
// Same treatment as the outline: the chart's SVG machinery should not ride in
// the bundle for the many page visits that only open the cast.
const TimelineSection = dynamic(() => import('@/components/timeline/TimelineSection'), { ssr: false })
// Same treatment again, for a sharper reason: the panel pulls in the whole chat
// surface AND issues its scope read on mount (LOOM-118).
const ExplorePanel = dynamic(() => import('@/components/explore/ExplorePanel'), {
  ssr: false,
  loading: () => <ExplorePanelSkeleton />,
})
import ExplorePanelSkeleton from '@/components/editor/ExplorePanelSkeleton'
import { useBookEvents } from '@/components/timeline/useBookEvents'
import type { ChapterChoice } from '@/components/editor/EventModal'
import { writerPortraitUrl } from '@/lib/writerPortrait'
import type { WriterCharacter } from '@/lib/characterSearch'

// The Characters tab's own editor, reused rather than reimplemented — it is
// the only place WriteAI-owned fields are edited, and it already knows the
// verbatim-PUT rule. Loaded on demand: this page usually renders without it.
const CharacterModal = dynamic(() => import('@/components/editor/CharacterModal'), { ssr: false })

type Stats = { chapterCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Book = { id: string; title: string; synopsis: string; coverPath: string | null; published: boolean; stats: Stats }
// Resolved-for-this-book shape from
// /api/series/[seriesId]/books/[bookId]/writer-characters (LOOM-88).
//
// Two owners in one object: `name`, `category`, `role`, `aliases` and
// `writerPhotoUrl` are WriteAI's and are read-only here — they are edited in
// the Characters tab's own modal, which this page opens rather than
// reimplementing. Everything else is Loom's overlay and is edited here.
type Character = {
  id: string
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  writerPhotoUrl: string | null
  age: number | null
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  starred: boolean
  hasAvatar: boolean
  hasBookAvatar: boolean
  hasCanonicalAvatar: boolean
  hasOverride: boolean
  hasOverlay: boolean
  taggedInBook: boolean
  visible: boolean
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


// Covers arrive straight from art tools as multi-MB PNGs; downscale to a
// display-appropriate JPEG before upload so /covers never accumulates
// 15MB originals (they render identically at a few hundred KB). 1600px on
// the long edge is ~2x the largest size any view renders a cover at.
async function downscaleCoverToBlob(file: File, maxEdge = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const ctx = canvas.getContext('2d')!
    // JPEG has no alpha channel — flatten any transparency to white instead
    // of the black canvas default.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.85),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
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
  // One modal, not two. Editing a character opens the Characters tab's own
  // editor with this book's context attached, so WriteAI's fields and Loom's
  // are the same dialog — a dialog that opens a second dialog to finish one
  // edit is a seam showing through.
  const [charAvatarTs, setCharAvatarTs] = useState(0)
  // Loom's side of the Timeline tab (LOOM-103): which events are tagged here.
  // Cheap — one query plus one canon walk — and the tab is filtered by it.
  const bookEvents = useBookEvents(seriesId, bookId)
  // Chapters a newly created event can be tagged to, so it does not vanish
  // from a tab filtered by tag.
  //
  // Labelled by TITLE, with no number. authorContext carries Chapter.order,
  // which is NOT the canon display number — the canon walk skips unnumbered
  // chapters and counts the prologue as 0, so `order` and the number printed in
  // the manuscript diverge. Showing `order` here would put a number on screen
  // that disagrees with the book, which is the exact class of bug LOOM-98/100
  // dealt with. Getting the real numbers means the walk, and that is not worth
  // a page-load for a picker whose chapters are already titled "Chapter 8".
  const chapterChoices: ChapterChoice[] = useMemo(
    () =>
      (series.books.find(b => b.id === bookId)?.chapters ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(c => ({ id: c.id, title: c.title, number: null })),
    [series.books, bookId],
  )
  // WriteAI's side: the pool (for the relationship picker and duplicate-name
  // check inside CharacterModal) and whichever character that modal is
  // editing. 'create' opens it empty.
  const [writerPool, setWriterPool] = useState<WriterCharacter[]>([])
  const [writerModal, setWriterModal] = useState<'create' | WriterCharacter | null>(null)
  // The resolved row behind the open modal — Loom's half of the same person.
  const [editingOverlay, setEditingOverlay] = useState<Character | null>(null)

  function openEditModal(c: Character) {
    const record = writerPool.find(w => w.id === c.id)
    if (!record) return
    setEditingOverlay(c)
    setCharAvatarTs(Date.now())
    setWriterModal(record)
  }
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
    // Book-scoped: WriteAI's records joined to Loom's overlay for this book.
    // The route returns characters hidden by a later first appearance too,
    // flagged rather than dropped; the author's grid filters them here so the
    // reader's page can make its own choice.
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/writer-characters`)
    if (res.ok) {
      // This book's cast, not WriteAI's whole world. A character earns a place
      // in the grid by being tagged in one of this book's chapters or by Loom
      // holding something about them; without this the grid listed all 63
      // records against the 24 the Character-era page showed.
      const all = (await res.json()) as Character[]
      setCharacters(all.filter(c => c.visible && (c.hasOverlay || c.taggedInBook)))
    }
  }, [seriesId, bookId])

  // Portrait for this book: per-book file, else the canonical file, else
  // WriteAI's photo. The chain lives in writerPortraitUrl so the reader and
  // the dock cannot drift from this page about what a character looks like.
  function avatarUrlFor(c: Character | null, ts: number): string | null {
    return c ? writerPortraitUrl(c, bookId, ts) : null
  }

  // WriteAI's pool, read from Loom's snapshot — never from
  // /api/writeai/characters, which writes to disk on WriteAI's side.
  const loadWriterPool = useCallback(async () => {
    const res = await fetch('/api/writeai/characters/snapshot')
    if (res.ok) setWriterPool(await res.json())
  }, [])

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
  useEffect(() => { loadWriterPool() }, [loadWriterPool])
  useEffect(() => { loadFrontMatter() }, [loadFrontMatter])

  // Creating a character means creating it in WriteAI — that is where a
  // character now exists. Loom's overlay is added afterwards, in onSaved.
  function openCreateModal() {
    setWriterModal('create')
  }

  // Called by CharacterModal once WriteAI has the record. New characters
  // created from a book default to "first appears in" THIS book so they don't
  // leak back into earlier books; existing ones keep whatever overlay they
  // already had.
  async function onWriterCharacterSaved(saved: WriterCharacter) {
    const isNew = !characters.some(c => c.id === saved.id)
    if (isNew) {
      await fetch(`/api/series/${seriesId}/writer-characters/${saved.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstBookId: bookId }),
      })
    }
    // The snapshot is Loom's copy of WriteAI's pool, so it has to be told a
    // write happened — nothing refreshes it on a timer, by design.
    await fetch('/api/writeai/characters/snapshot', { method: 'POST' })
    await Promise.all([loadCharacters(), loadWriterPool()])
    setCharAvatarTs(Date.now())
    setWriterModal(null)
  }

  // Quick-toggle handlers — used by the hover buttons on each character
  // card so the writer doesn't have to open the modal for these common
  // ops. Both PATCH the canonical row and refetch the resolved list so
  // the dependent fields (`hidden`, `starred`) come back consistent.
  async function toggleStarred(c: Character) {
    await fetch(`/api/series/${seriesId}/writer-characters/${c.id}`, {
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
    await fetch(`/api/series/${seriesId}/writer-characters/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastBookId: nextLastBookId }),
    })
    await loadCharacters()
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
    // Downscale before upload; fall back to the original file if the
    // browser can't decode it (the server accepts either).
    let upload: File = file
    try {
      const blob = await downscaleCoverToBlob(file)
      upload = new File([blob], 'cover.jpg', { type: 'image/jpeg' })
    } catch { /* keep original */ }
    const form = new FormData()
    form.append('cover', upload)
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
      {/* Wider than the 3xl it was: the outline is a board of cards, and at
          768px it could only ever be one column, which is not an outline —
          it is a list of chapters you have to scroll to compare. Everything
          else on the page simply gets more room.
          Capped rather than uncapped, because an ultrawide display would
          otherwise stretch the synopsis into a single unreadable line; 1600px
          is past the width of the laptops this is used on, so in practice the
          page fills the window. */}
      <div className="max-w-[1600px] mx-auto px-8 py-8">
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
          {/* Export (.loom.json) sits beside Download deliberately (KAN-20).
              A standalone project's landing page IS its book page — the
              switcher routes name-clicks straight here, because a standalone
              author has no series outline to see. Series-level export lives on
              the series page, which nothing links to for a standalone, so
              before this button the ONLY reachable data backup for those
              projects was the root Write page. That is what blocked orphaning
              `/`: the manuscript was downloadable, the data was not.

              KAN-19 first split these as Export/Download, but both rendered
              with the same download icon and read as near-synonyms — a real
              coin-flip at the point of use. They are now Backup vs Save, with
              distinct icons: the verb and the glyph both carry the difference.

              Backup = .loom.json, the re-importable data. NOT a complete
              system backup: chapter notes, narration audio, reader sessions
              and cover image files live only in dev.db and public/covers. The
              nightly chain covers those; this button is for portability. */}
          <a
            href={`/api/series/${seriesId}/books/${bookId}/export`}
            download
            title="Back up this book's story data as a .loom.json you can re-import. Covers prose, choices and characters — not chapter notes, narration or cover images."
            className="px-3 py-1.5 rounded text-xs bg-surface-overlay text-ink-muted border border-accent/20 font-medium hover:text-ink transition flex items-center gap-1.5"
          >
            <LuDatabaseBackup size={12} /> Backup
          </a>
          {/* Save = the readable manuscript (Pages/Word), the thing you hand to
              a person. Distinct verb AND icon from Backup above. */}
          <button
            onClick={() => setShowExportModal(true)}
            title="Save this book as a Pages manuscript to read or share"
            className="px-3 py-1.5 rounded text-xs bg-surface-overlay text-ink-muted border border-accent/20 font-medium hover:text-ink transition flex items-center gap-1.5"
          >
            <LuSave size={12} /> Save
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

        {/* Outline, Characters and Soundtrack, as tabs rather than a stack —
            only one of them is ever the thing you came for, and stacked they
            pushed each other off the screen.

            Outline leads because it is the planning surface: it answers "what
            is this book" where the other two answer "what is in it". */}
        <SectionTabs
          id="book"
          sections={[{
            id: 'outline',
            label: 'Outline',
            content: <OutlineSection seriesId={seriesId} bookId={bookId} />,
          }, {
            id: 'characters',
            label: 'Character(s)',
            action: (
              <button
                onClick={openCreateModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
              >
                <LuPlus size={12} /> Add Character
              </button>
            ),
            content: (
              <>
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
              </>
            ),
          }, {
            // Every chapter's soundtrack blocks, in story order.
            id: 'soundtrack',
            label: 'Soundtrack',
            content: (
              <>
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
              </>
            ),
          }, {
            // Last, deliberately. LOOM-93 put Outline first because it is the
            // planning surface — "what is this book" — where the others answer
            // "what is in it". Timeline is squarely in the second group and is
            // the newest, so it takes the end rather than displacing anything.
            id: 'timeline',
            label: 'Timeline',
            content: (
              <TimelineSection
                id="book"
                eventIds={bookEvents.eventIds}
                appearances={bookEvents.appearances}
                chapterChoices={chapterChoices}
                emptyTitle="No events tagged to this book"
                emptyBody="Events exist in WriteAI but none are tagged to a chapter here yet. Tag them from a chapter’s Events tab, or add one above and pick a chapter."
                onEventCreated={async (created, chapterId) => {
                  // Creating from a tag-filtered view: without a tag the new
                  // event fails this tab's own filter and vanishes. The dock
                  // tags implicitly because it is open ON a chapter; here the
                  // writer picks one, and may legitimately pick none.
                  if (chapterId) {
                    await fetch(`/api/chapters/${chapterId}/events`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ writerEventId: created.id }),
                    })
                  }
                  await bookEvents.refresh()
                }}
              />
            ),
          }, {
            // Last in the strip, as on the series page. Scope is THIS BOOK AND
            // EVERYTHING BEFORE IT — a book page can only draw on what a reader
            // has already read, and the rule is enforced in the proxy rather
            // than in the dropdown (LOOM-112/114).
            id: 'explore',
            label: 'Explore',
            content: <ExplorePanel seriesId={seriesId} bookId={bookId} bookTitle={book.title} />,
          }]}
        />

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

      {/* WriteAI's own character editor, opened from this page rather than
          rebuilt in it. It owns name, category, aliases, traits, goals, arc
          notes and relationships, and it already carries the rule that every
          save must send the COMPLETE record — WriteAI's PUT stores bodies
          verbatim, so a partial write deletes fields.

          Deleting the WriteAI record is deliberately NOT offered here: it
          would strip the character out of every writer-event that names them
          and out of canon lookup, which is a Characters-tab decision. */}
      {writerModal !== null && (
        <CharacterModal
          character={writerModal === 'create' ? undefined : writerModal}
          pool={writerPool}
          books={[...series.books].sort((a, b) => a.order - b.order).map(b => b.title)}
          allowDelete={false}
          bookContext={{
            seriesId,
            bookId,
            bookTitle: book.title,
            books: series.books,
            overlay: editingOverlay && {
              age: editingOverlay.age,
              starred: editingOverlay.starred,
              firstBookId: editingOverlay.firstBookId,
              deathBookId: editingOverlay.deathBookId,
              lastBookId: editingOverlay.lastBookId,
              hasOverride: editingOverlay.hasOverride,
              hasBookAvatar: editingOverlay.hasBookAvatar,
              portraitUrl: avatarUrlFor(editingOverlay, charAvatarTs),
            },
            onOverlaySaved: async () => {
              await loadCharacters()
              setCharAvatarTs(Date.now())
            },
          }}
          onSaved={onWriterCharacterSaved}
          onDeleted={() => { setWriterModal(null); setEditingOverlay(null) }}
          onClose={() => { setWriterModal(null); setEditingOverlay(null) }}
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
