'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { LuBookOpen, LuSearch, LuX } from 'react-icons/lu'

type ExploreSeries = {
  id: string
  title: string
  description: string
  genres: string[]
  keywords: string[]
  heroCoverPath: string | null
  publishedBookCount: number
  totalBookCount: number
  bookTitles: string[]
}

// Reader-facing landing. Lists every series with at least one published
// book; each card links to the existing /preview/series/[seriesId] landing
// where the reader can read more and start a session.
export default function ExplorePage() {
  const [series, setSeries] = useState<ExploreSeries[] | null>(null)
  const [query, setQuery] = useState('')
  // Active genre filter — multi-select with OR semantics. Empty set means
  // no filter applied (every series passes the genre check).
  const [activeGenres, setActiveGenres] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/explore')
      .then(r => r.ok ? r.json() : [])
      .then(setSeries)
      .catch(() => setSeries([]))
  }, [])

  // Genres that any series actually uses — derived from the data so the
  // filter row doesn't show dead options that match nothing.
  const availableGenres = useMemo(() => {
    if (!series) return []
    const all = new Set<string>()
    for (const s of series) for (const g of s.genres) all.add(g)
    return [...all].sort()
  }, [series])

  // Search + genre filter. Series title, keywords, and book titles all
  // contribute to the text match; genre filter is OR across selections.
  const filtered = useMemo(() => {
    if (!series) return []
    const q = query.trim().toLowerCase()
    return series.filter(s => {
      if (activeGenres.length > 0 && !s.genres.some(g => activeGenres.includes(g))) {
        return false
      }
      if (!q) return true
      const matchesTitle = s.title.toLowerCase().includes(q)
      const matchesKeyword = s.keywords.some(k => k.toLowerCase().includes(q))
      const matchesBook = s.bookTitles.some(t => t.toLowerCase().includes(q))
      return matchesTitle || matchesKeyword || matchesBook
    })
  }, [series, query, activeGenres])

  function toggleGenre(genre: string) {
    setActiveGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    )
  }

  if (series == null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  const filtersActive = query.trim() !== '' || activeGenres.length > 0

  return (
    <div className="px-8 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Explore</h1>
        <p className="text-sm text-ink-muted mt-1">
          Find your next great read
        </p>
      </div>

      {series.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <div className="relative">
            <LuSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title, keyword, or book name…"
              className="w-full bg-surface-raised border border-accent/15 rounded-lg pl-9 pr-9 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition"
              >
                <LuX size={14} />
              </button>
            )}
          </div>
          {availableGenres.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-faint mr-1">Genre(s)</span>
              {availableGenres.map(g => {
                const on = activeGenres.includes(g)
                return (
                  <button
                    type="button"
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      on
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface-overlay text-ink-muted border-accent/15 hover:border-accent/40 hover:text-ink'
                    }`}
                  >
                    {g}
                  </button>
                )
              })}
              {activeGenres.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveGenres([])}
                  className="text-[11px] text-ink-faint hover:text-ink transition ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {series.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-accent/20 px-8 py-16 text-center">
          <p className="text-sm text-ink-faint italic">
            Nothing to read yet. Publish a book from the Write view to see it here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-accent/20 px-8 py-16 text-center">
          <p className="text-sm text-ink-faint italic">
            {filtersActive ? 'No series match your filters.' : 'No series to show.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(s => (
            <Link
              key={s.id}
              href={`/preview/series/${s.id}`}
              className="group flex gap-4 p-4 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
            >
              <div className="relative w-40 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center">
                {s.heroCoverPath
                  ? <Image src={s.heroCoverPath} alt="" fill sizes="160px" className="object-cover" />
                  : <LuBookOpen size={32} className="text-ink-faint" />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <p className="font-semibold text-ink truncate group-hover:text-accent transition">{s.title}</p>
                <p className="text-[11px] uppercase tracking-widest text-ink-faint mt-0.5">
                  {s.totalBookCount} book(s)
                  {s.publishedBookCount < s.totalBookCount && (
                    <> ({s.publishedBookCount} published)</>
                  )}
                </p>
                {s.description && (
                  // Scroll overflow so readers can sample the whole blurb
                  // without leaving the card. Gradient fade at the bottom
                  // hints "more below" the same way the book landing does.
                  <div className="relative mt-2">
                    <div className="overflow-y-auto pr-1 max-h-[140px]">
                      <p className="text-xs text-ink-muted leading-relaxed">{s.description}</p>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised to-transparent" />
                  </div>
                )}
                {(s.genres.length > 0 || s.keywords.length > 0) && (
                  <div className="mt-auto pt-2 flex flex-col gap-1.5">
                    {s.genres.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.genres.map(g => (
                          <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white">{g}</span>
                        ))}
                      </div>
                    )}
                    {s.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.keywords.map(k => (
                          <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
