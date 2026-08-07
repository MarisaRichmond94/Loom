'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { LuArrowRight, LuBookOpen } from 'react-icons/lu'
import dynamic from 'next/dynamic'

// Only rendered after the author byline is clicked — load on first open.
const AuthorModal = dynamic(() => import('@/components/AuthorModal'), { ssr: false })

type Book = {
  id: string
  title: string
  synopsis: string
  coverPath: string | null
  order: number
  published: boolean
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
  const [authorName, setAuthorName] = useState('')
  const [authorModalOpen, setAuthorModalOpen] = useState(false)
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
      // Per-series author override (set by the demo seed) wins; falls
      // back to the global profile so real series stay attributed to
      // the writer. Honors pseudonym so readers never see the real name.
      const override = (data.authorOverrideName ?? '').trim()
      if (override) {
        setAuthorName(override)
      } else {
        const profileRes = await fetch('/api/settings/profile')
        if (profileRes.ok) {
          const p: { authorName?: string; pseudonymEnabled?: boolean; pseudonym?: string } = await profileRes.json()
          const real = (p.authorName ?? '').trim()
          const pen = (p.pseudonym ?? '').trim()
          setAuthorName(p.pseudonymEnabled && pen ? pen : real)
        }
      }
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
      <div className="h-full flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <header className="border-b border-accent/10">
        <div className="max-w-4xl mx-auto px-8 pt-12 pb-8">
          {/* Row 1: title and Start reading on the same baseline. Description,
              genres, and keywords drop below at full width. */}
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-3xl md:text-4xl font-bold text-ink leading-tight uppercase tracking-wide">{series.title}</h1>
              {authorName && (
                <p className="text-sm text-ink-muted mt-1">
                  by{' '}
                  <button
                    type="button"
                    onClick={() => setAuthorModalOpen(true)}
                    className="hover:text-ink hover:underline transition"
                  >
                    {authorName}
                  </button>
                </p>
              )}
            </div>
            {series.books.some(b => b.published) && (
              <button
                onClick={() => startReading()}
                disabled={working != null}
                className="shrink-0 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {working === 'series' ? 'Opening…' : 'Start reading'} <LuArrowRight size={14} />
              </button>
            )}
          </div>
          {series.description && (
            <p className="mt-4 text-base text-ink-muted leading-relaxed whitespace-pre-wrap">{series.description}</p>
          )}
          {series.genres.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Genre(s)</span>
              {series.genres.map(g => (
                <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-accent text-white">{g}</span>
              ))}
            </div>
          )}
          {series.keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Keyword(s)</span>
              {series.keywords.map(k => (
                <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 pt-6 pb-10">
        <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Books in this series</h2>
        {series.books.length === 0 ? (
          <p className="text-sm text-ink-faint italic">No books yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {series.books.map((book, idx) => {
              // Unpublished books still appear in the roadmap so readers see
              // what's coming, but the cover is faded, no synopsis leaks, and
              // the card isn't a link.
              const card = (
                <>
                  <div className={`relative w-40 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center ${!book.published ? 'opacity-40' : ''}`}>
                    {book.coverPath
                      ? <Image
                          src={book.coverPath}
                          alt=""
                          fill
                          // sizes hint lets Next.js serve a properly downsampled
                          // WebP/AVIF instead of forcing the browser to scale
                          // the original 5–15MB PNG to a 160-px box.
                          sizes="160px"
                          className="object-cover"
                        />
                      : <LuBookOpen size={28} className="text-ink-faint" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs uppercase tracking-widest text-ink-faint">Book {idx + 1}</p>
                      {!book.published && (
                        <span className="text-[10px] uppercase tracking-widest text-ink-faint border border-accent/30 rounded px-1.5 py-0.5">Coming soon</span>
                      )}
                    </div>
                    <p className={`font-semibold text-lg mt-1 leading-tight ${book.published ? 'text-ink' : 'text-ink-muted'}`}>{book.title}</p>
                    {book.published && book.synopsis && (
                      <>
                        <p className="text-sm text-ink-muted mt-2 line-clamp-8 leading-relaxed">{book.synopsis}</p>
                        {/* Visual cue inside the already-clickable card. The
                            parent <a> owns navigation; this is just to give
                            readers an obvious target if the card-as-link
                            affordance isn't obvious. */}
                        <div className="mt-2 text-right">
                          <span className="text-xs text-accent font-medium group-hover/card:underline">
                            See more
                          </span>
                        </div>
                      </>
                    )}
                    {!book.published && (
                      // Blurred lorem placeholder so the card keeps the same
                      // height as a published one and the reader can sense
                      // there's "more to come" without spoilers leaking.
                      // select-none + pointer-events-none keeps it from being
                      // copied or interacted with. Body is long enough to
                      // saturate the line-clamp so the card fills the cover's
                      // vertical space instead of leaving a dead band below.
                      <p
                        aria-hidden
                        className="text-sm text-ink-muted mt-2 line-clamp-8 leading-relaxed blur-sm select-none pointer-events-none"
                      >
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                        Sed do eiusmod tempor incididunt ut labore et dolore magna
                        aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                        ullamco laboris nisi ut aliquip ex ea commodo consequat.
                        Duis aute irure dolor in reprehenderit in voluptate velit
                        esse cillum dolore eu fugiat nulla pariatur. Excepteur sint
                        occaecat cupidatat non proident, sunt in culpa qui officia
                        deserunt mollit anim id est laborum. Curabitur pretium
                        tincidunt lacus, nulla gravida orci a odio. Nullam varius,
                        turpis et commodo pharetra, est eros bibendum elit.
                      </p>
                    )}
                  </div>
                </>
              )
              return book.published ? (
                <a
                  key={book.id}
                  href={`/author/preview/book/${book.id}`}
                  className="group/card flex gap-5 p-5 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
                >
                  {card}
                </a>
              ) : (
                <div
                  key={book.id}
                  className="flex gap-5 p-5 rounded-lg bg-surface-raised border border-accent/10 cursor-default"
                >
                  {card}
                </div>
              )
            })}
          </div>
        )}
      </main>
      {authorModalOpen && (
        <AuthorModal
          authorName={authorName}
          excludeSeriesId={seriesId}
          onClose={() => setAuthorModalOpen(false)}
        />
      )}
    </div>
  )
}
