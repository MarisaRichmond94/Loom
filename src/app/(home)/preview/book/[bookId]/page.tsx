'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { LuArrowRight, LuArrowLeft, LuBookOpen, LuChevronDown, LuUser, LuMusic, LuStar } from 'react-icons/lu'
import PinnedAudio from '@/components/PinnedAudio'
import { pinLabel } from '@/lib/pinLabel'
import dynamic from 'next/dynamic'

// Only rendered after the author byline is clicked — load on first open.
const AuthorModal = dynamic(() => import('@/components/AuthorModal'), { ssr: false })

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
type Character = {
  id: string
  name: string
  age: number | null
  hasAvatar: boolean
  hasBookAvatar?: boolean
  hasCanonicalAvatar?: boolean
  deceased?: boolean
  hidden?: boolean
  starred?: boolean
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

// Approx row height (52px) × 4.5 = 234, plus 4 × 8 (gap-2) = 32. Bumped a
// touch above 266 so the half-row peek lands clearly and signals "scrollable
// for more."
const CHAPTER_LIST_MAX_HEIGHT = 270

// Public book landing page. Inherits genre + keyword tags from the parent
// series (per the v1 decision to keep tags series-level). The Start Reading
// CTA spins up a reader session lazily, reusing one cached in localStorage
// so the same reader resumes across visits.
export default function PreviewBookPage() {
  const { bookId } = useParams() as { bookId: string }
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [authorName, setAuthorName] = useState('')
  const [authorModalOpen, setAuthorModalOpen] = useState(false)
  const [characters, setCharacters] = useState<Character[]>([])
  const [soundtracks, setSoundtracks] = useState<Soundtrack[]>([])
  // POV character names taken from every chapter's `pov` field across every
  // book in the series — same scope as the author book page so the chips on
  // both sides match. A set for O(1) membership lookup in the render loop.
  const [povNames, setPovNames] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  // Sections default open per spec; readers can collapse them to focus on
  // any single section. State is per-section so the others stay where the
  // reader left them.
  const [chaptersOpen, setChaptersOpen] = useState(true)
  const [charactersOpen, setCharactersOpen] = useState(true)
  const [soundtrackOpen, setSoundtrackOpen] = useState(true)
  // Track whether the synopsis is scrolled to its bottom so we can hide the
  // gradient fade once there's nothing more to reveal. `atBottom` is true
  // when the content isn't overflowing either — no fade needed in that case.
  const synopsisScrollRef = useRef<HTMLDivElement | null>(null)
  const [synopsisAtBottom, setSynopsisAtBottom] = useState(true)
  function updateSynopsisScroll() {
    const el = synopsisScrollRef.current
    if (!el) return
    setSynopsisAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
  }
  useEffect(() => {
    // After the synopsis renders, recompute — the initial measurement
    // depends on the rendered text height.
    updateSynopsisScroll()
  }, [book?.synopsis])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Sequential book → series fetch (we need the bookData.seriesId to
      // load the parent series for inherited tags, the cast, and the
      // soundtrack list — all are series-scoped endpoints).
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

      // Walk every chapter in every book to collect the names that appear
      // as a POV. The series endpoint already includes books → chapters,
      // so this is free off the same fetch.
      type ChapterPov = { pov?: string | null }
      type BookWithChapters = { chapters?: ChapterPov[] }
      const povs = new Set<string>()
      for (const b of (s.books ?? []) as BookWithChapters[]) {
        for (const ch of b.chapters ?? []) {
          if (ch.pov) povs.add(ch.pov)
        }
      }
      setPovNames(povs)

      // Per-series author override (set by the demo seed) wins; otherwise
      // fall back to the global profile so real series stay attributed to
      // the writer. Honors pseudonym for the global path.
      const override = (s.authorOverrideName ?? '').trim()
      if (override) {
        if (!cancelled) setAuthorName(override)
      } else {
        const profileRes = await fetch('/api/settings/profile').catch(() => null)
        if (!cancelled && profileRes?.ok) {
          const profile: {
            authorName?: string; pseudonymEnabled?: boolean; pseudonym?: string
          } = await profileRes.json()
          const real = (profile.authorName ?? '').trim()
          const pen = (profile.pseudonym ?? '').trim()
          setAuthorName(profile.pseudonymEnabled && pen ? pen : real)
        }
      }

      // Cast + soundtrack are non-spoiler context, so fetch them for drafts
      // too. The Chapters section stays gated on `published` below — chapter
      // titles can give away the plot.
      const [charactersRes, soundtracksRes] = await Promise.all([
        fetch(`/api/series/${bookData.seriesId}/books/${bookId}/characters`),
        fetch(`/api/series/${bookData.seriesId}/books/${bookId}/soundtracks`),
      ])
      if (cancelled) return
      if (charactersRes.ok) setCharacters(await charactersRes.json())
      if (soundtracksRes.ok) setSoundtracks(await soundtracksRes.json())
    }
    load()
    return () => { cancelled = true }
  }, [bookId])

  // chapterId is optional; when omitted the reader lands on the book's first
  // chapter (the Start Reading flow). When clicking a row in the Chapters
  // list, the row's chapter is passed in to deep-link.
  async function startReading(chapterId?: string) {
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
    const targetChapter =
      chapterId ?? [...book.chapters].sort((a, b) => a.order - b.order)[0]?.id
    const url = targetChapter
      ? `/read/${sessionId}?startChapterId=${targetChapter}`
      : `/read/${sessionId}`
    router.push(url)
  }

  if (!book) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  const orderedChapters = [...book.chapters].sort((a, b) => a.order - b.order)

  // Resolves the per-book or canonical avatar URL the same way the author
  // book page does. The reader doesn't have a cache-busting timestamp to
  // worry about — covers and avatars are stable across the public visit.
  function characterAvatarUrl(c: Character): string | null {
    if (c.hasBookAvatar) return `/characters/${c.id}-${bookId}.jpg`
    if (c.hasCanonicalAvatar || c.hasAvatar) return `/characters/${c.id}.jpg`
    return null
  }

  return (
    <div>
      <header className="border-b border-accent/10">
        <div className="px-8 pt-12 pb-8 flex flex-col md:flex-row gap-8 items-start">
          <div className={`relative w-44 md:w-56 shrink-0 rounded-lg overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center ${!book.published ? 'opacity-40' : ''}`}>
            {book.coverPath
              ? <Image
                  src={book.coverPath}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 176px, 224px"
                  className="object-cover"
                  priority
                />
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
            {/* Title + Start reading share a baseline row (mirroring the
                series landing) so the CTA is anchored to a steady spot
                regardless of synopsis length. Coming-soon badge stays
                next to the title. */}
            <div className="mt-2 flex items-center justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl md:text-4xl font-bold text-ink leading-tight">{book.title}</h1>
                  {!book.published && (
                    <span className="text-[11px] uppercase tracking-widest text-ink-faint border border-accent/30 rounded px-2 py-0.5">Coming soon</span>
                  )}
                </div>
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
              <button
                onClick={() => startReading()}
                disabled={working || !book.published || orderedChapters.length === 0}
                className="shrink-0 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {working
                  ? 'Opening…'
                  : book.published && orderedChapters.length === 0
                    ? 'No chapters yet'
                    : 'Start reading'}
                {book.published && !working && orderedChapters.length > 0 && <LuArrowRight size={14} />}
              </button>
            </div>
            {book.synopsis ? (
              // Cap the synopsis so it ends at the cover's bottom edge.
              // Cover heights (w-44 / w-56 × 2:3) are 264px / 336px;
              // subtract the breadcrumb + title row + author byline above
              // (~110px) and the chip rows below need to start at cover
              // bottom. The gradient fade-out signals "scroll for more".
              <div className="relative mt-4">
                <div
                  ref={synopsisScrollRef}
                  onScroll={updateSynopsisScroll}
                  className="overflow-y-auto pr-2 max-h-[150px] md:max-h-[224px]"
                >
                  <p className="text-base text-ink-muted leading-relaxed whitespace-pre-wrap">{book.synopsis}</p>
                </div>
                <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-base to-transparent transition-opacity ${synopsisAtBottom ? 'opacity-0' : 'opacity-100'}`} />
              </div>
            ) : !book.published && (
              <p className="mt-4 text-sm text-ink-faint italic leading-relaxed">
                This book is still being written. Check back soon.
              </p>
            )}
            {series && series.genres.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Genre(s)</span>
                {series.genres.map(g => (
                  <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-accent text-white">{g}</span>
                ))}
              </div>
            )}
            {series && series.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">Keyword(s)</span>
                {series.keywords.map(k => (
                  <span key={k} className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="px-8 pt-6 pb-10 flex flex-col gap-8">
        {/* Chapters — kept gated on `published`; chapter titles can be
            spoilers, unlike the cast and soundtrack sections. */}
        {book.published && (
          <section>
            <SectionHeader
              label={`Chapters (${orderedChapters.length})`}
              open={chaptersOpen}
              onToggle={() => setChaptersOpen(o => !o)}
            />
            {chaptersOpen && (
              orderedChapters.length === 0 ? (
                <p className="text-sm text-ink-faint italic mt-3">No chapters yet.</p>
              ) : (
                // Cap at ~4.5 rows so very long books don't dominate the page.
                // The gradient fade + half-row peek combine to signal "more
                // below"; the half-row alone wasn't reading clearly enough
                // for less-intuitive readers.
                <div className="relative mt-3">
                  <div
                    className="overflow-y-auto pr-1"
                    style={{ maxHeight: CHAPTER_LIST_MAX_HEIGHT }}
                  >
                    <ol className="flex flex-col gap-2">
                      {orderedChapters.map(ch => (
                        <li key={ch.id}>
                          <button
                            type="button"
                            onClick={() => startReading(ch.id)}
                            disabled={working}
                            className="w-full text-left px-4 py-3 rounded bg-surface-raised border border-accent/10 text-sm text-ink hover:border-accent/40 hover:bg-surface-overlay transition disabled:opacity-50"
                          >
                            {ch.title}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {orderedChapters.length > 5 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-base to-transparent" />
                  )}
                </div>
              )
            )}
          </section>
        )}

        {/* Characters — same per-book resolution as the author page so any
            per-book overrides (age, avatar) follow the reader. Hidden
            characters are filtered out of this view entirely; the author
            still sees them on their grid with an indicator. */}
          {(() => {
            const visibleCharacters = characters.filter(c => !c.hidden)
            return (
              <section>
                <SectionHeader
                  label={`Characters (${visibleCharacters.length})`}
                  open={charactersOpen}
                  onToggle={() => setCharactersOpen(o => !o)}
                />
                {charactersOpen && (
                  visibleCharacters.length === 0 ? (
                    <p className="text-sm text-ink-faint italic mt-3">No characters introduced yet.</p>
                  ) : (
                    <div
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8, alignContent: 'start' }}
                      className="mt-3"
                    >
                      {visibleCharacters.map(c => {
                        const url = characterAvatarUrl(c)
                        const isPov = povNames.has(c.name)
                        return (
                          <div
                            key={c.id}
                            className={`relative flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-raised border h-[146px] w-full ${isPov ? 'border-accent' : 'border-accent/10'}`}
                          >
                            {c.starred && (
                              <LuStar
                                size={12}
                                className="absolute top-1.5 right-1.5 fill-accent text-accent"
                              />
                            )}
                            <div className={`w-20 h-20 rounded-full overflow-hidden border-2 bg-surface-overlay flex items-center justify-center shrink-0 ${isPov ? 'border-accent' : 'border-accent/20'}`}>
                              {url
                                ? <img src={url} alt={c.name} className="w-full h-full object-cover" />
                                : <LuUser size={32} className="text-ink-faint" />}
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-medium text-ink truncate w-full">{c.name}</p>
                              {c.deceased
                                ? <p className="text-[10px] uppercase tracking-widest text-ink-faint italic">Deceased</p>
                                : c.age != null && <p className="text-xs text-ink-faint">Age {c.age}</p>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </section>
            )
          })()}

          {/* Soundtrack — every chapter's soundtrack blocks, in story order.
              Read-only: no album-art swap, no remove. PinnedAudio still
              honors the writer's pinStart/pinEnd so readers can sample the
              tagged snippet. */}
          <section>
            <SectionHeader
              label="Soundtrack"
              open={soundtrackOpen}
              onToggle={() => setSoundtrackOpen(o => !o)}
            />
            {soundtrackOpen && (
              soundtracks.length === 0 ? (
                <p className="text-sm text-ink-faint italic mt-3">No songs yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {soundtracks.map((s, idx) => {
                    const label = pinLabel(s.pinStart, s.pinEnd)
                    const chapterDisplay = s.chapterTitle?.trim() || `Chapter ${s.chapterOrder}`
                    const artUrl = s.hasAlbumArt ? `/music/${s.id}-art.jpg` : null
                    return (
                      <div key={s.id} className="px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-ink-faint shrink-0 w-6 text-right">{idx + 1}</span>
                          <div className="shrink-0 w-10 h-10 rounded overflow-hidden border border-accent/10 bg-surface-overlay flex items-center justify-center">
                            {artUrl
                              ? <img src={artUrl} alt="" className="w-full h-full object-cover" />
                              : <LuMusic size={14} className="text-accent" />}
                          </div>
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
                          <p className={`text-xs text-ink-faint italic mt-2 ${artUrl ? 'pl-[3.75rem]' : 'pl-9'}`}>{label}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
        </section>
      </main>
      {authorModalOpen && (
        <AuthorModal
          authorName={authorName}
          excludeSeriesId={book.seriesId}
          onClose={() => setAuthorModalOpen(false)}
        />
      )}
    </div>
  )
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-ink hover:opacity-80 transition"
    >
      <LuChevronDown
        size={14}
        className={`transition-transform ${open ? '' : '-rotate-90'}`}
      />
      {label}
    </button>
  )
}
