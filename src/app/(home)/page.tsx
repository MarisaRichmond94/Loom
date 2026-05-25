'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { LuBookOpen, LuSearch, LuSearchX, LuX, LuChevronDown, LuCheck, LuStar, LuArrowRight } from 'react-icons/lu'
import { GENRES } from '@/lib/genres'
import {
  getStarredSeries,
  toggleStarredSeries,
  getActiveReaderSessions,
  forgetReaderSession,
} from '@/lib/readerProgress'

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

type ResumeEntry = {
  sessionId: string
  seriesId: string
  seriesTitle: string
  seriesHeroCoverPath: string | null
  currentChapterId: string | null
  currentChapterTitle: string | null
  currentBookTitle: string | null
  hasProgress: boolean
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
  const [genreMenuOpen, setGenreMenuOpen] = useState(false)
  const [genreFilterQuery, setGenreFilterQuery] = useState('')
  const genreMenuRef = useRef<HTMLDivElement>(null)
  const genreFilterInputRef = useRef<HTMLInputElement>(null)
  // Reader-side state lives in localStorage; mirror it in component state
  // so renders react to toggles immediately.
  const [starred, setStarred] = useState<string[]>([])
  const [resumeEntries, setResumeEntries] = useState<ResumeEntry[]>([])
  // Server profile drives the byline on every card. Pseudonym takes
  // precedence when it's enabled so a reader never sees the author's
  // real name.
  const [authorByline, setAuthorByline] = useState('')

  // Focus the search input as the dropdown opens; clear it on close so the
  // next visit starts fresh.
  useEffect(() => {
    if (genreMenuOpen) {
      requestAnimationFrame(() => genreFilterInputRef.current?.focus())
    } else {
      setGenreFilterQuery('')
    }
  }, [genreMenuOpen])

  // Close the genre dropdown when the user mousedowns anywhere outside it.
  // Escape also closes — handled on the dropdown's onKeyDown.
  useEffect(() => {
    if (!genreMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      if (genreMenuRef.current && !genreMenuRef.current.contains(e.target as Node)) {
        setGenreMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [genreMenuOpen])

  useEffect(() => {
    fetch('/api/explore')
      .then(r => r.ok ? r.json() : [])
      .then(setSeries)
      .catch(() => setSeries([]))
  }, [])

  // Hydrate the starred list from localStorage after mount. SSR can't see
  // localStorage so we keep initial state empty and fill in client-side.
  useEffect(() => {
    setStarred(getStarredSeries())
  }, [])

  // Author byline — same source as the preview pages so a reader sees a
  // consistent display name everywhere.
  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then((p: { authorName?: string; pseudonymEnabled?: boolean; pseudonym?: string } | null) => {
        if (!p) return
        const real = (p.authorName ?? '').trim()
        const pen = (p.pseudonym ?? '').trim()
        setAuthorByline(p.pseudonymEnabled && pen ? pen : real)
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  // Load Continue Reading entries. Walks every cached session id in
  // localStorage, asks the server for the resume context in one batch,
  // prunes any that 404'd, and filters to sessions that actually have
  // progress so a "just-started, never-touched" session doesn't appear.
  useEffect(() => {
    const cached = getActiveReaderSessions()
    if (cached.length === 0) { setResumeEntries([]); return }
    let cancelled = false
    fetch('/api/sessions/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: cached.map(c => c.sessionId) }),
    })
      .then(r => r.ok ? r.json() : [])
      .then((rows: ResumeEntry[]) => {
        if (cancelled) return
        const returnedIds = new Set(rows.map(r => r.seriesId))
        // Drop localStorage entries the server didn't return — usually
        // means the session was deleted.
        for (const c of cached) {
          if (!returnedIds.has(c.seriesId)) forgetReaderSession(c.seriesId)
        }
        setResumeEntries(rows.filter(r => r.hasProgress))
      })
      .catch(() => { if (!cancelled) setResumeEntries([]) })
    return () => { cancelled = true }
  }, [])

  function toggleStar(seriesId: string) {
    setStarred(toggleStarredSeries(seriesId))
  }

  // Show every genre from the canonical list so the reader can find any
  // tag the platform supports — not just the subset currently in use.
  // The in-dropdown search whittles it down as they type.
  const visibleGenresInMenu = useMemo(() => {
    const q = genreFilterQuery.trim().toLowerCase()
    if (!q) return [...GENRES]
    return GENRES.filter(g => g.toLowerCase().includes(q))
  }, [genreFilterQuery])

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
    <div className="min-h-full px-8 py-10 flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Explore</h1>
        <p className="text-sm text-ink-muted mt-1">
          Find your next great read
        </p>
      </div>

      {resumeEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-3">Continue reading</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {resumeEntries.map(r => (
              <Link
                key={r.sessionId}
                href={`/read/${r.sessionId}`}
                className="group flex items-stretch gap-3 p-3 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
              >
                <div className="relative w-14 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center">
                  {r.seriesHeroCoverPath
                    ? <Image src={r.seriesHeroCoverPath} alt="" fill sizes="56px" className="object-cover" />
                    : <LuBookOpen size={16} className="text-ink-faint" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <p className="text-sm font-semibold text-ink truncate group-hover:text-accent transition">{r.seriesTitle}</p>
                  {(r.currentBookTitle || r.currentChapterTitle) && (
                    <p className="text-xs text-ink-muted truncate mt-0.5">
                      {r.currentBookTitle ?? ''}{r.currentBookTitle && r.currentChapterTitle ? ' · ' : ''}{r.currentChapterTitle ?? ''}
                    </p>
                  )}
                </div>
                <div className="self-center shrink-0 text-accent">
                  <LuArrowRight size={16} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {series.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <LuSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by book/series title or keyword…"
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
          <div ref={genreMenuRef} className="relative shrink-0">
            {/* Both trigger and dropdown share the same width so the
                dropdown reads as a continuation of the field. w-44 is
                tuned to the canonical genre list's longest entry
                ("Contemporary") + the checkbox + padding chrome. */}
            <button
              type="button"
              onClick={() => setGenreMenuOpen(o => !o)}
              onKeyDown={e => { if (e.key === 'Escape') setGenreMenuOpen(false) }}
              className={`w-44 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition ${
                activeGenres.length > 0
                  ? 'bg-accent/10 border-accent/40 text-ink'
                  : 'bg-surface-raised border-accent/15 text-ink-muted hover:border-accent/40 hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-2">
                Genre(s)
                {activeGenres.length > 0 && (
                  <span className="text-[10px] bg-accent text-white rounded-full px-1.5 py-0.5 leading-none">
                    {activeGenres.length}
                  </span>
                )}
              </span>
              <LuChevronDown
                size={14}
                className={`transition-transform ${genreMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {genreMenuOpen && (
              <div
                onKeyDown={e => { if (e.key === 'Escape') setGenreMenuOpen(false) }}
                className="absolute top-full right-0 mt-2 w-44 z-20 bg-surface-raised border border-accent/20 rounded-lg shadow-xl overflow-hidden"
              >
                {/* In-dropdown filter. Pulled from the canonical genre list
                    so the reader can find every supported tag, not just
                    ones already in the catalog. */}
                <div className="relative border-b border-accent/10">
                  <LuSearch size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    ref={genreFilterInputRef}
                    value={genreFilterQuery}
                    onChange={e => setGenreFilterQuery(e.target.value)}
                    placeholder="Filter genres…"
                    className="w-full bg-transparent pl-8 pr-3 py-2 text-xs text-ink placeholder:text-ink-faint outline-none"
                  />
                </div>
                <div className="relative">
                  {visibleGenresInMenu.length === 0 ? (
                    <p className="text-xs text-ink-faint italic px-3 py-3 text-center">No matches.</p>
                  ) : (
                    <>
                      {/* ~40px per row × 4.5 = 180px, so the fifth option
                          peeks as a "scroll for more" cue. Gradient fades
                          to surface-raised — the dropdown's own bg. */}
                      <div className="overflow-y-auto max-h-[180px] py-1">
                        {visibleGenresInMenu.map(g => {
                          const on = activeGenres.includes(g)
                          return (
                            <button
                              type="button"
                              key={g}
                              onClick={() => toggleGenre(g)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition ${
                                on
                                  ? 'text-ink bg-accent/10'
                                  : 'text-ink-muted hover:bg-surface-overlay hover:text-ink'
                              }`}
                            >
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  on ? 'bg-accent border-accent' : 'border-accent/30'
                                }`}
                              >
                                {on && <LuCheck size={11} className="text-white" />}
                              </span>
                              {g}
                            </button>
                          )
                        })}
                      </div>
                      {visibleGenresInMenu.length > 4 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised to-transparent" />
                      )}
                    </>
                  )}
                </div>
                {activeGenres.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveGenres([])}
                    className="w-full text-xs text-ink-muted hover:text-ink transition py-2 border-t border-accent/10"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {series.length === 0 ? (
        <div className="flex-1 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10 flex items-center justify-center">
          <p className="text-sm text-ink-faint italic text-center">
            Nothing to read yet. Publish a book from the Write view to see it here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10 flex items-center justify-center">
          <div className="flex flex-col items-center text-center">
            <LuSearchX size={80} className="text-ink-faint mb-3" />
            <p className="text-base text-ink">
              {filtersActive
                ? 'No books or series match the applied search parameters'
                : 'No series to show'}
            </p>
            {filtersActive && (
              <p className="text-sm text-ink-muted mt-2">Try adjusting or relaxing your filter(s)</p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(s => {
            const isStarred = starred.includes(s.id)
            return (
            <Link
              key={s.id}
              href={`/preview/series/${s.id}`}
              className="group relative flex gap-4 p-4 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
            >
              {/* Star toggle — preventDefault keeps the outer link from
                  navigating; the click is purely a localStorage flip. */}
              <button
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); toggleStar(s.id) }}
                title={isStarred ? 'Unstar this series' : 'Star this series'}
                className={`absolute top-3 right-3 p-1 rounded transition ${
                  isStarred
                    ? 'text-accent'
                    : 'text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink'
                }`}
              >
                <LuStar size={16} className={isStarred ? 'fill-accent' : ''} />
              </button>
              <div className="relative w-40 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center">
                {s.heroCoverPath
                  ? <Image src={s.heroCoverPath} alt="" fill sizes="160px" className="object-cover" />
                  : <LuBookOpen size={32} className="text-ink-faint" />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <p className="font-semibold text-ink truncate pr-8 group-hover:text-accent transition">{s.title}</p>
                {authorByline && (
                  <p className="text-xs text-ink-muted truncate">by {authorByline}</p>
                )}
                <p className={`text-[11px] uppercase tracking-widest text-ink-faint ${authorByline ? 'mt-2' : 'mt-0.5'}`}>
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
          )})}
        </div>
      )}
    </div>
  )
}
