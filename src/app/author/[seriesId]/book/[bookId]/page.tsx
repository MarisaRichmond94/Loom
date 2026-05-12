'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'

type Stats = { chapterCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Book = { id: string; title: string; synopsis: string; coverPath: string | null; stats: Stats }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Series = {
  id: string; title: string
  books: { id: string; title: string; order: number; chapters: { id: string; title: string; order: number }[] }[]
  variables: Variable[]
}

export default function BookDetailPage() {
  const { seriesId, bookId } = useParams() as { seriesId: string; bookId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadSeries = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

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

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadBook() }, [loadBook])

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
  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, defaultValue }) })
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
    <div className="min-h-screen bg-surface-base flex flex-col">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <span className="text-ink-faint self-center">›</span>
        <Link href={`/author/${seriesId}`} className="text-ink-muted hover:text-ink self-center">{series.title}</Link>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink self-center">{book.title}</span>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-surface-raised border-r border-accent/10 p-4 flex flex-col gap-6 overflow-y-auto">
          <OutlineTree seriesId={seriesId} books={series.books} onAddBook={addBook} onAddChapter={addChapter} />
          <VariablesPanel variables={series.variables} onAdd={addVariable} onDelete={deleteVariable} />
        </aside>

        <main className="flex-1 overflow-y-auto">
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

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl relative">
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
                className="px-4 py-2 rounded-lg border border-accent/20 text-ink-muted text-sm hover:text-ink transition"
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
