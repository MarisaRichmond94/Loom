'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { LuSearch, LuX } from 'react-icons/lu'
import { FaBookOpen } from 'react-icons/fa'

type Hit = {
  bookId: string
  bookTitle: string
  bookOrder: number
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  blockId: string | null
  kind: 'prose' | 'prompt' | 'choice' | 'override' | 'chapter-title'
  snippet: string
  matchStart: number
  matchLength: number
}

type Book = { id: string; title: string }

const KIND_LABEL: Record<Hit['kind'], string> = {
  prose: 'Prose',
  prompt: 'Prompt',
  choice: 'Choice',
  override: 'Override',
  'chapter-title': 'Title',
}

const DEBOUNCE_MS = 200

export default function SearchBar({ seriesId, books }: { seriesId: string; books: Book[] }) {
  // Seed from the URL so navigating from a previous search result lands
  // here with the same query already populated. Pure read of the initial
  // value — subsequent typing owns the state.
  const initialQuery = useSearchParams()?.get('q') ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [bookFilter, setBookFilter] = useState<Set<string>>(new Set())  // empty = all books
  const [showFilter, setShowFilter] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Click-outside closes the panel without losing the query — writers
  // can reopen by focusing the input again.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowFilter(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ⌥⇧F focuses + selects the input from anywhere in author mode, so the
  // writer doesn't have to leave the keyboard to start a search. e.code
  // (not e.key) so the binding survives the Option key's char shifting
  // on macOS — ⌥F produces 'ƒ' which would break a key-based match.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return
      if (e.code !== 'KeyF') return
      e.preventDefault()
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.select()
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Debounced fetch. Each keystroke re-arms the timer so we don't fire a
  // request for every character. `cancelled` keeps an in-flight response
  // from stomping on a newer query if the user kept typing.
  const runFetch = useCallback(async (q: string, bookIds: string[]) => {
    if (!q.trim()) { setHits([]); setLoading(false); return }
    setLoading(true)
    const qs = new URLSearchParams({ q })
    if (bookIds.length > 0) qs.set('bookIds', bookIds.join(','))
    try {
      const res = await fetch(`/api/series/${seriesId}/search?${qs.toString()}`)
      if (!res.ok) { setHits([]); setLoading(false); return }
      const data = await res.json()
      setHits(data.hits ?? [])
    } finally {
      setLoading(false)
    }
  }, [seriesId])

  useEffect(() => {
    const bookIds = Array.from(bookFilter)
    const id = setTimeout(() => { runFetch(query, bookIds) }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, bookFilter, runFetch])

  function toggleBook(id: string) {
    setBookFilter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Group hits by chapter so a single chapter with N matches renders as
  // one block with N rows underneath rather than N independent header
  // strips. Maintains the walk order from the API (book → chapter).
  const grouped: Array<{ bookTitle: string; chapterId: string; chapterTitle: string; items: Hit[] }> = []
  for (const h of hits) {
    const last = grouped[grouped.length - 1]
    if (last && last.chapterId === h.chapterId) last.items.push(h)
    else grouped.push({ bookTitle: h.bookTitle, chapterId: h.chapterId, chapterTitle: h.chapterTitle, items: [h] })
  }

  function hrefFor(h: Hit): string {
    // Pass q= alongside block= so the destination chapter page highlights
    // matches in its TipTap surfaces. URLSearchParams handles encoding so
    // a query with spaces / unicode survives the trip.
    const params = new URLSearchParams()
    if (h.blockId) params.set('block', h.blockId)
    const q = query.trim()
    if (q) params.set('q', q)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return `/author/${seriesId}/chapter/${h.chapterId}${suffix}`
  }

  function renderSnippet(h: Hit) {
    const pre = h.snippet.slice(0, h.matchStart)
    const mid = h.snippet.slice(h.matchStart, h.matchStart + h.matchLength)
    const post = h.snippet.slice(h.matchStart + h.matchLength)
    return (
      <>
        <span className="text-ink-faint">{pre}</span>
        <mark className="bg-accent/30 text-ink rounded px-0.5">{mid}</mark>
        <span className="text-ink-faint">{post}</span>
      </>
    )
  }

  const filterTitle = bookFilter.size === 0
    ? 'Filter by book — all books included'
    : bookFilter.size === 1
      ? `Filter: ${books.find(b => bookFilter.has(b.id))?.title ?? '1 book'}`
      : `Filter: ${bookFilter.size} books`

  return (
    <div ref={rootRef} className="relative flex items-center min-w-0">
      {/* Single fixed-width input with search icon on the left and book-
          filter + clear buttons on the right. Keeping every interactive
          element inside the input prevents the surrounding header from
          reflowing when the filter label changes width. */}
      <div className="relative flex items-center w-52">
        <LuSearch size={12} className="absolute left-2 text-ink-faint pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search the series…"
          title="Search the series (⌥⇧F)"
          className="w-full pl-7 pr-14 py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {query && (
            <button
              onClick={() => { setQuery(''); setHits([]); setOpen(false) }}
              className="text-ink-faint hover:text-ink p-0.5"
              title="Clear"
            >
              <LuX size={12} />
            </button>
          )}
          <button
            onClick={() => setShowFilter(o => !o)}
            title={filterTitle}
            className={`relative p-0.5 transition ${bookFilter.size > 0 ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
          >
            <FaBookOpen size={11} />
            {bookFilter.size > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-surface-raised border border-accent/20 rounded-lg shadow-xl min-w-[200px] max-h-64 overflow-y-auto">
          <button
            onClick={() => setBookFilter(new Set())}
            className={`w-full px-3 py-2 text-xs text-left transition border-b border-accent/10 ${bookFilter.size === 0 ? 'text-accent' : 'text-ink-muted hover:text-ink hover:bg-surface-overlay'}`}
          >
            All books
          </button>
          {books.map(b => {
            const on = bookFilter.has(b.id)
            return (
              <button
                key={b.id}
                onClick={() => toggleBook(b.id)}
                className={`w-full px-3 py-2 text-xs text-left transition flex items-center gap-2 ${on ? 'text-accent bg-accent/5' : 'text-ink-muted hover:text-ink hover:bg-surface-overlay'}`}
              >
                <span className={`inline-block w-3 h-3 rounded-sm border ${on ? 'bg-accent border-accent' : 'border-accent/40'}`} />
                <span className="truncate">{b.title}</span>
              </button>
            )
          })}
        </div>
      )}

      {open && query.trim() && (
        <div className="absolute top-full left-0 mt-1 z-40 bg-surface-raised border border-accent/20 rounded-lg shadow-xl w-[28rem] max-h-[60vh] overflow-y-auto">
          {loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-xs text-ink-faint italic">Searching…</p>
          ) : grouped.length === 0 ? (
            <p className="px-4 py-3 text-xs text-ink-faint italic">No matches.</p>
          ) : (
            <div className="divide-y divide-accent/10">
              {grouped.map(g => (
                <div key={g.chapterId}>
                  <div className="px-3 py-1.5 bg-surface-overlay/50 text-[10px] uppercase tracking-widest text-ink-faint sticky top-0">
                    {g.bookTitle} — {g.chapterTitle}
                  </div>
                  {g.items.map((h, i) => (
                    <a
                      key={`${h.blockId ?? 'title'}-${h.kind}-${i}`}
                      href={hrefFor(h)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 hover:bg-surface-overlay/40 transition"
                    >
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-accent/80 shrink-0">{KIND_LABEL[h.kind]}</span>
                      </div>
                      <p className="text-xs leading-relaxed">{renderSnippet(h)}</p>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
