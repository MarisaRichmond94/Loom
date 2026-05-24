'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuArrowRight, LuArrowLeft, LuBookOpen } from 'react-icons/lu'

type Chapter = { id: string; title: string; order: number }
type Book = {
  id: string
  title: string
  synopsis: string
  coverPath: string | null
  order: number
  seriesId: string
  published: boolean
  chapters: Chapter[]
}
type Series = {
  id: string
  title: string
  genres: string[]
  keywords: string[]
}

// Public book landing page. Inherits genre + keyword tags from the parent
// series (per the v1 decision to keep tags series-level). The Start Reading
// CTA spins up a reader session lazily, reusing one cached in localStorage
// so the same reader resumes across visits.
export default function PreviewBookPage() {
  const { bookId } = useParams() as { bookId: string }
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Sequential book → series fetch (we need the bookData.seriesId to
      // load the parent series for inherited tags).
      const res = await fetch(`/api/books/${bookId}`)
      if (!res.ok || cancelled) return
      const bookData: Book = await res.json()
      setBook(bookData)
      const seriesRes = await fetch(`/api/series/${bookData.seriesId}`)
      if (!seriesRes.ok || cancelled) return
      const s = await seriesRes.json()
      const parseList = (v: unknown): string[] => {
        if (typeof v !== 'string') return []
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
      }
      setSeries({ id: s.id, title: s.title, genres: parseList(s.genres), keywords: parseList(s.keywords) })
    }
    load()
    return () => { cancelled = true }
  }, [bookId])

  async function startReading() {
    if (!book || working || !book.published) return
    setWorking(true)
    const cacheKey = `loom-session-${book.seriesId}`
    let sessionId = localStorage.getItem(cacheKey)
    if (sessionId) {
      const check = await fetch(`/api/sessions/${sessionId}`)
      if (!check.ok) sessionId = null
    }
    if (!sessionId) {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: book.seriesId }),
      })
      if (!res.ok) { setWorking(false); return }
      const session = await res.json()
      sessionId = session.id
      localStorage.setItem(cacheKey, sessionId!)
    }
    const firstChapter = [...book.chapters].sort((a, b) => a.order - b.order)[0]?.id
    const url = firstChapter
      ? `/read/${sessionId}?startChapterId=${firstChapter}`
      : `/read/${sessionId}`
    router.push(url)
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  const orderedChapters = [...book.chapters].sort((a, b) => a.order - b.order)

  return (
    <div className="min-h-screen bg-surface-base">
      <header className="border-b border-accent/10">
        <div className="max-w-3xl mx-auto px-8 py-12 flex flex-col md:flex-row gap-8 items-start">
          <div className={`w-44 md:w-56 shrink-0 rounded-lg overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center ${!book.published ? 'opacity-40' : ''}`}>
            {book.coverPath
              ? <img src={book.coverPath} alt="" className="w-full h-full object-cover" />
              : <LuBookOpen size={40} className="text-ink-faint" />}
          </div>
          <div className="flex-1 min-w-0">
            {series && (
              <a
                href={`/preview/series/${series.id}`}
                className="text-xs uppercase tracking-widest text-ink-faint hover:text-ink transition flex items-center gap-1.5"
              >
                <LuArrowLeft size={11} /> {series.title}
              </a>
            )}
            <div className="mt-2 flex items-baseline gap-3 flex-wrap">
              <h1 className="text-3xl md:text-4xl font-bold text-ink leading-tight">{book.title}</h1>
              {!book.published && (
                <span className="text-[11px] uppercase tracking-widest text-ink-faint border border-accent/30 rounded px-2 py-0.5">Coming soon</span>
              )}
            </div>
            {book.published && book.synopsis && (
              <p className="mt-4 text-base text-ink-muted leading-relaxed whitespace-pre-wrap">{book.synopsis}</p>
            )}
            {!book.published && (
              <p className="mt-4 text-sm text-ink-faint italic leading-relaxed">
                This book is still being written. Check back soon.
              </p>
            )}
            {series && series.genres.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Genres</span>
                {series.genres.map(g => (
                  <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-accent text-white">{g}</span>
                ))}
              </div>
            )}
            {series && series.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Keywords</span>
                {series.keywords.map(k => (
                  <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
                ))}
              </div>
            )}
            <button
              onClick={startReading}
              disabled={working || !book.published || orderedChapters.length === 0}
              className="mt-6 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
            >
              {!book.published
                ? 'Coming soon'
                : working
                  ? 'Opening…'
                  : orderedChapters.length === 0
                    ? 'No chapters yet'
                    : 'Start reading'}
              {book.published && !working && orderedChapters.length > 0 && <LuArrowRight size={14} />}
            </button>
          </div>
        </div>
      </header>

      {book.published && (
        <main className="max-w-3xl mx-auto px-8 py-10">
          <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Chapters</h2>
          {orderedChapters.length === 0 ? (
            <p className="text-sm text-ink-faint italic">No chapters yet.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {orderedChapters.map(ch => (
                <li key={ch.id} className="px-4 py-3 rounded bg-surface-raised border border-accent/10 flex items-baseline gap-3">
                  <span className="text-xs text-ink-faint tabular-nums shrink-0 w-8">{ch.order}</span>
                  <span className="text-sm text-ink">{ch.title}</span>
                </li>
              ))}
            </ol>
          )}
        </main>
      )}
    </div>
  )
}
