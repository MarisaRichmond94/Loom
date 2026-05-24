'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuArrowRight, LuBookOpen } from 'react-icons/lu'

type Book = {
  id: string
  title: string
  synopsis: string
  coverPath: string | null
  order: number
}

type Series = {
  id: string
  title: string
  description: string
  genres: string[]
  keywords: string[]
  books: Book[]
}

// Public-facing landing page for a series. No auth — anyone with the URL
// can see this; reading sessions are created lazily when a reader clicks
// "Start Reading" on a book card. Designed to feel like a discovery page
// (Wattpad-ish): cover collage, blurb, genre + keyword chips, then the
// stacked book list.
export default function PreviewSeriesPage() {
  const { seriesId } = useParams() as { seriesId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/series/${seriesId}`).then(async r => {
      if (!r.ok) return
      const data = await r.json()
      const parseList = (s: unknown): string[] => {
        if (typeof s !== 'string') return []
        try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
      }
      setSeries({
        ...data,
        genres: parseList(data.genres),
        keywords: parseList(data.keywords),
      })
    })
  }, [seriesId])

  async function startReading() {
    if (!series || working) return
    setWorking('series')
    // Resume the same session across visits so a reader's progress sticks
    // even though there's no user account yet. Keyed per series so a reader
    // following multiple series doesn't collide them.
    const cacheKey = `loom-session-${series.id}`
    let sessionId = localStorage.getItem(cacheKey)
    if (sessionId) {
      // Verify the session still exists on the server; if it was deleted,
      // fall through and create a fresh one rather than 404 the reader.
      const check = await fetch(`/api/sessions/${sessionId}`)
      if (!check.ok) sessionId = null
    }
    if (!sessionId) {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: series.id }),
      })
      if (!res.ok) { setWorking(null); return }
      const session = await res.json()
      sessionId = session.id
      localStorage.setItem(cacheKey, sessionId!)
    }
    router.push(`/read/${sessionId}`)
  }

  if (!series) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-base">
      <header className="border-b border-accent/10">
        <div className="max-w-4xl mx-auto px-8 py-12">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-bold text-ink leading-tight uppercase tracking-wide">{series.title}</h1>
            {series.description && (
              <p className="mt-4 text-base text-ink-muted leading-relaxed whitespace-pre-wrap">{series.description}</p>
            )}
            {(series.genres.length > 0 || series.keywords.length > 0) && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {series.genres.map(g => (
                  <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-accent text-white">{g}</span>
                ))}
                {series.keywords.map(k => (
                  <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
                ))}
              </div>
            )}
            {series.books.length > 0 && (
              <button
                onClick={() => startReading()}
                disabled={working != null}
                className="mt-6 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {working === 'series' ? 'Opening…' : 'Start reading'} <LuArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-10">
        <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Books in this series</h2>
        {series.books.length === 0 ? (
          <p className="text-sm text-ink-faint italic">No books yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {series.books.map((book, idx) => (
              <a
                key={book.id}
                href={`/preview/book/${book.id}`}
                className="flex gap-5 p-5 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
              >
                <div className="w-24 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center">
                  {book.coverPath
                    ? <img src={book.coverPath} alt="" className="w-full h-full object-cover" />
                    : <LuBookOpen size={20} className="text-ink-faint" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase tracking-widest text-ink-faint">Book {idx + 1}</p>
                  <p className="font-semibold text-ink mt-1">{book.title}</p>
                  {book.synopsis && (
                    <p className="text-sm text-ink-muted mt-2 line-clamp-3 leading-relaxed">{book.synopsis}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
