'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LuMoon, LuSun, LuDownload } from 'react-icons/lu'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

type Chapter = { id: string; title: string; order: number }
type Book = { id: string; title: string; order: number; chapters: Chapter[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Series = { id: string; title: string; books: Book[]; variables: Variable[] }
type ChoiceQuestion = { id: string; prompt: string; chapterId: string; chapterTitle: string; bookTitle: string }
type BookStats = { chapterCount: number; wordCount: number; uniquePovs: number; choiceCount: number; coverPath: string | null }

export default function AuthorSeriesPage() {
  const { seriesId } = useParams() as { seriesId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [choiceQuestions, setChoiceQuestions] = useState<ChoiceQuestion[]>([])
  const [bookStats, setBookStats] = useState<Record<string, BookStats>>({})
  const [titleDraft, setTitleDraft] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [lightMode, setLightMode] = useState(() => typeof window !== 'undefined' && localStorage.getItem('loom-light-mode') === 'true')

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) {
      const data = await res.json()
      setSeries(data)
      const stats = await Promise.all(
        data.books.map((b: Book) =>
          fetch(`/api/series/${seriesId}/books/${b.id}`).then(r => r.ok ? r.json() : null)
        )
      )
      setTitleDraft(data.title)
      const statsMap: Record<string, BookStats> = {}
      data.books.forEach((b: Book, i: number) => {
        if (stats[i]?.stats) statsMap[b.id] = { ...stats[i].stats, coverPath: stats[i].coverPath ?? null }
      })
      setBookStats(statsMap)
    }
  }, [seriesId])

  const loadChoices = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/choices`)
    if (res.ok) setChoiceQuestions(await res.json())
  }, [seriesId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadChoices() }, [loadChoices])
  useEffect(() => { setAuthorName(localStorage.getItem('loom-author-name') ?? '') }, [])

  async function handleTitleBlur() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === series?.title) return
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    })
    setSeries(prev => prev ? { ...prev, title: trimmed } : null)
  }

  async function handleDeleteBook(bookId: string) {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, { method: 'DELETE' })
    setDeleteTarget(null)
    load()
  }

  async function addBook(title: string) {
    await fetch(`/api/series/${seriesId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    load()
  }

  async function addChapter(bookId: string, title: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const chapter = await res.json()
    await load()
    router.push(`/author/${seriesId}/chapter/${chapter.id}`)
  }

  async function insertChapter(bookId: string, title: string, atOrder: number) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, insertAtOrder: atOrder }),
    })
    const chapter = await res.json()
    await load()
    router.push(`/author/${seriesId}/chapter/${chapter.id}`)
  }

  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, defaultValue }),
    })
    load()
  }

  async function updateVariable(id: string, name: string, type: string) {
    await fetch(`/api/variables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type }) })
    load()
  }
  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    load()
  }

  if (!series) return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">
      Loading…
    </div>
  )

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink self-center">{series.title}</span>
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
            <div className="flex flex-col items-center mb-8">
              <input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={handleTitleBlur}
                className="w-full bg-transparent border-none outline-none text-center text-3xl font-bold uppercase text-ink tracking-wide focus:opacity-80 transition-opacity"
              />
              {authorName && (
                <p className="text-sm text-ink-faint mt-1">by {authorName}</p>
              )}
            </div>
            {series.books.length === 0 ? (
              <p className="text-ink-faint text-sm text-center mt-16">No books yet. Add one from the outline.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {series.books.map((book, idx) => {
                  const stats = bookStats[book.id]
                  return (
                    <div
                      key={book.id}
                      onClick={() => router.push(`/author/${seriesId}/book/${book.id}`)}
                      className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20 hover:border-accent/40 hover:scale-[1.01] transition-all duration-150 cursor-pointer"
                    >
                      <div className="w-28 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 flex items-center justify-center" style={{ minHeight: '9rem' }}>
                        {stats?.coverPath ? (
                          <img src={stats.coverPath} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-ink-faint text-center px-1">No cover</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-baseline gap-3 mb-4">
                            <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">Book {idx + 1}</span>
                            <span className="font-semibold text-ink text-lg leading-tight">{book.title}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-3">
                            {[
                              { label: 'Chapter(s)', value: stats?.chapterCount ?? '—' },
                              { label: 'Word(s)', value: stats ? stats.wordCount.toLocaleString() : '—' },
                              { label: 'POV(s)', value: stats?.uniquePovs ?? '—' },
                              { label: 'Choice(s)', value: stats?.choiceCount ?? '—' },
                            ].map(({ label, value }) => (
                              <div key={label} className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-4 flex flex-col items-center gap-1">
                                <span className="text-xl font-bold text-ink">{value}</span>
                                <span className="text-xs text-ink-faint uppercase tracking-widest">{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-3" onClick={e => e.stopPropagation()}>
                          <a
                            href={`/api/series/${seriesId}/books/${book.id}/export`}
                            download
                            className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition flex items-center gap-1.5"
                          >
                            <LuDownload size={11} /> Export
                          </a>
                          <button
                            onClick={() => setDeleteTarget({ id: book.id, title: book.title })}
                            className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-choice-kill/40 text-choice-kill hover:opacity-80 transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setDeleteTarget(null)}
              className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-ink mb-3 pr-6">
              Are you sure you want to delete "{deleteTarget.title}"?
            </h2>
            <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
              Deleting this book is permanent and cannot be undone. All of its chapters, written content,
              and choices will be removed. Any story branches in later books that depended on choices
              made here will fall back to their default text.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteBook(deleteTarget.id)}
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
