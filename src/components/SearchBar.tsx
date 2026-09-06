'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import { LuSearch, LuX, LuReplace, LuCaseSensitive, LuWholeWord, LuSlidersHorizontal } from 'react-icons/lu'
import { FaBookOpen } from 'react-icons/fa'
import ConfirmDialog from '@/components/ConfirmDialog'
import { flushPendingProse, publishProseReplaced } from '@/lib/proseSync'

type Hit = {
  bookId: string
  bookTitle: string
  bookOrder: number
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  blockId: string | null
  kind: 'prose' | 'prompt' | 'choice' | 'override' | 'chapter-title'
  // Field-level pointer the per-hit replace endpoint uses to target
  // exactly the column this hit came from.
  recordKind: 'block' | 'choice' | 'override' | 'chapter'
  recordId: string
  field: 'content' | 'baseContent' | 'prompt' | 'label' | 'endingMessage' | 'title'
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
  const urlSearchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const initialQuery = urlSearchParams?.get('q') ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [bookFilter, setBookFilter] = useState<Set<string>>(new Set())  // empty = all books
  const [showFilter, setShowFilter] = useState(false)
  // Below 852px of viewport width, everything except the book filter (clear,
  // match case, match word, replace) folds into a popover behind one icon.
  // The header spans the full viewport (no sidebar-scoped container like the
  // chapter page's), so this tracks window width directly rather than a
  // ResizeObserver on an ancestor.
  const [compactSearch, setCompactSearch] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 852px)')
    setCompactSearch(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setCompactSearch(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // Match-case / whole-word toggles, persisted (shared with the chapter
  // find bar via the same localStorage keys) so it's one preference.
  const [matchCase, setMatchCase] = useState(false)
  const [matchWord, setMatchWord] = useState(false)
  useEffect(() => {
    setMatchCase(localStorage.getItem('loom-search-case') === 'true')
    setMatchWord(localStorage.getItem('loom-search-word') === 'true')
  }, [])
  function toggleMatchCase() { setMatchCase(v => { const n = !v; localStorage.setItem('loom-search-case', String(n)); return n }) }
  function toggleMatchWord() { setMatchWord(v => { const n = !v; localStorage.setItem('loom-search-word', String(n)); return n }) }
  // Replace mode: when on, a second input appears below for the
  // replacement string. Replace All hits the dry-run endpoint to count
  // matches across the book filter, then shows a confirmation modal
  // before persisting.
  const [replaceMode, setReplaceMode] = useState(false)
  const [replaceWith, setReplaceWith] = useState('')
  const [pendingReplace, setPendingReplace] = useState<{ total: number; counts: { prose: number; prompt: number; choice: number; override: number } } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Click-outside closes the panel without losing the query — writers
  // can reopen by focusing the input again.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowFilter(false)
        setShowOptions(false)
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
      if (e.code !== 'KeyG') return
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

  // ⌥⇧K also clears chapter search (see chapter page's own handler); this
  // listener mirrors that binding so the same keypress clears this box too.
  // A full reset, not just the query: book filter, match case/word, and
  // replace mode all go back to their defaults too, so the hotkey leaves
  // search in the same state a first-time visitor would see.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return
      if (e.code !== 'KeyK') return
      e.preventDefault()
      clearQuery()
      setBookFilter(new Set())
      setMatchCase(false)
      localStorage.setItem('loom-search-case', 'false')
      setMatchWord(false)
      localStorage.setItem('loom-search-word', 'false')
      setReplaceMode(false)
      setReplaceWith('')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Debounced fetch. Each keystroke re-arms the timer so we don't fire a
  // request for every character. `cancelled` keeps an in-flight response
  // from stomping on a newer query if the user kept typing.
  const runFetch = useCallback(async (q: string, bookIds: string[], caseSensitive: boolean, wholeWord: boolean) => {
    if (!q.trim()) { setHits([]); setLoading(false); return }
    setLoading(true)
    const qs = new URLSearchParams({ q })
    if (bookIds.length > 0) qs.set('bookIds', bookIds.join(','))
    if (caseSensitive) qs.set('caseSensitive', '1')
    if (wholeWord) qs.set('wholeWord', '1')
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
    const id = setTimeout(() => { runFetch(query, bookIds, matchCase, matchWord) }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, bookFilter, matchCase, matchWord, runFetch])

  function toggleBook(id: string) {
    setBookFilter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Clearing the box only resets this component's own state; the chapter
  // page's on-page highlight reads q/qc/qw straight off the URL (that's how
  // it survives the navigation from a search hit), so it keeps glowing
  // unless we strip those params here too.
  function clearQuery() {
    setQuery('')
    setHits([])
    setOpen(false)
    if (!urlSearchParams?.has('q')) return
    const params = new URLSearchParams(urlSearchParams.toString())
    params.delete('q')
    params.delete('qc')
    params.delete('qw')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? '/'), { scroll: false })
  }

  // Step 1 of Replace All: dry-run the endpoint to count matches under
  // the current book filter, then surface the totals in a ConfirmDialog
  // so the writer can back out before any DB writes happen.
  async function previewReplace() {
    const find = query.trim()
    if (!find) return
    setReplaceError(null)
    setReplacing(true)
    try {
      // Settle the open editor's write-behind saves first, or the count comes
      // back measured against prose the writer has already changed.
      await flushPendingProse()
      const bookIds = Array.from(bookFilter)
      const res = await fetch(`/api/series/${seriesId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ find, replace: replaceWith, bookIds, dryRun: true, caseSensitive: matchCase, wholeWord: matchWord }),
      })
      if (!res.ok) { setReplaceError('Could not preview replacements.'); return }
      const data = await res.json()
      setPendingReplace({ total: data.total, counts: data.counts })
    } finally { setReplacing(false) }
  }

  // Per-hit replace: targets exactly the column the hit came from. Used
  // when the writer hovers a single result and decides only THIS one
  // should change. Chapter-title hits are blocked (the bulk endpoint
  // doesn't touch them either — renumbering cascade lives elsewhere).
  async function replaceSingle(h: Hit) {
    const find = query.trim()
    if (!find) return
    if (h.recordKind === 'chapter') return
    setReplaceError(null)
    try {
      await flushPendingProse()
      const res = await fetch(`/api/series/${seriesId}/replace/single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          find, replace: replaceWith,
          recordKind: h.recordKind, recordId: h.recordId, field: h.field,
          caseSensitive: matchCase, wholeWord: matchWord,
        }),
      })
      if (!res.ok) { setReplaceError('Replace failed.'); return }
      const data = await res.json()
      // Tell any editor holding this chapter to rebuild from the rewritten
      // row, before its stale copy can be PATCHed back over the replacement.
      publishProseReplaced({ seriesId, chapterIds: data.chapterIds ?? [] })
      // Refresh matches so the now-rewritten row drops out of (or
      // updates in) the list.
      runFetch(query, Array.from(bookFilter), matchCase, matchWord)
    } catch { setReplaceError('Replace failed.') }
  }

  // Step 2: persist the replace. Re-issues the same call with dryRun=false,
  // then refetches matches so the dropdown reflects the post-replace state.
  async function confirmReplace() {
    const find = query.trim()
    if (!find) return
    setReplaceError(null)
    setReplacing(true)
    try {
      // Same flush as the preview: the writer may have kept typing between
      // opening the confirm dialog and accepting it.
      await flushPendingProse()
      const bookIds = Array.from(bookFilter)
      const res = await fetch(`/api/series/${seriesId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ find, replace: replaceWith, bookIds, dryRun: false, caseSensitive: matchCase, wholeWord: matchWord }),
      })
      if (!res.ok) { setReplaceError('Replace failed.'); return }
      const data = await res.json()
      setPendingReplace(null)
      // Any editor open on a rewritten chapter still holds pre-replace prose;
      // tell it to rebuild before a keystroke PATCHes that copy back.
      publishProseReplaced({ seriesId, chapterIds: data.chapterIds ?? [] })
      // Refresh the match list so the writer sees the new state.
      runFetch(query, bookIds, matchCase, matchWord)
    } finally { setReplacing(false) }
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
    // Carry the match options so the destination chapter highlights exactly
    // what the series search matched.
    if (matchCase) params.set('qc', '1')
    if (matchWord) params.set('qw', '1')
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
    <div ref={rootRef} className="relative flex items-center flex-1 min-w-0">
      {/* Single fixed-width input with search icon on the left and book-
          filter + clear buttons on the right. Keeping every interactive
          element inside the input prevents the surrounding header from
          reflowing when the filter label changes width. */}
      <div className="relative flex items-center w-96 min-w-32">
        <LuSearch size={12} className="absolute left-2 text-ink-faint pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={compactSearch ? 'Search…' : 'Search the series… (⌥⇧G)'}
          title="Search the series (⌥⇧G)"
          className={`w-full pl-7 py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 ${compactSearch ? 'pr-14' : 'pr-[92px]'}`}
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {compactSearch ? (
            <div className="relative">
              <button
                onClick={() => setShowOptions(o => !o)}
                title="Search options"
                aria-haspopup="menu"
                aria-expanded={showOptions}
                className={`p-0.5 rounded transition ${
                  query || matchCase || matchWord || replaceMode || showOptions ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <LuSlidersHorizontal size={12} />
              </button>
              {showOptions && (
                <div
                  role="menu"
                  className="absolute top-full right-0 mt-1.5 z-50 w-44 bg-surface-raised border border-accent/20 rounded-xl shadow-xl p-1 flex flex-col"
                >
                  {query && (
                    <button
                      onClick={() => { clearQuery(); setShowOptions(false) }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left text-ink-muted hover:text-ink hover:bg-surface-base transition"
                    >
                      <LuX size={13} className="shrink-0" />
                      Clear
                    </button>
                  )}
                  <button
                    onClick={toggleMatchCase}
                    aria-pressed={matchCase}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${matchCase ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                  >
                    <LuCaseSensitive size={13} className="shrink-0" />
                    Match case
                  </button>
                  <button
                    onClick={toggleMatchWord}
                    aria-pressed={matchWord}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${matchWord ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                  >
                    <LuWholeWord size={13} className="shrink-0" />
                    Match whole word
                  </button>
                  <button
                    onClick={() => { setReplaceMode(o => !o); setOpen(true); setShowOptions(false) }}
                    aria-pressed={replaceMode}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${replaceMode ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                  >
                    <LuReplace size={12} className="shrink-0" />
                    Find and replace
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {query && (
                <button
                  onClick={clearQuery}
                  className="text-ink-faint hover:text-ink p-0.5"
                  title="Clear"
                >
                  <LuX size={12} />
                </button>
              )}
              <button
                onClick={toggleMatchCase}
                title="Match case"
                aria-pressed={matchCase}
                className={`p-0.5 rounded transition ${matchCase ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'}`}
              >
                <LuCaseSensitive size={13} />
              </button>
              <button
                onClick={toggleMatchWord}
                title="Match whole word"
                aria-pressed={matchWord}
                className={`p-0.5 rounded transition ${matchWord ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'}`}
              >
                <LuWholeWord size={13} />
              </button>
              <button
                onClick={() => { setReplaceMode(o => !o); setOpen(true) }}
                title={replaceMode ? 'Hide replace input' : 'Find and replace'}
                className={`p-0.5 transition ${replaceMode ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
              >
                <LuReplace size={11} />
              </button>
            </>
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
          {replaceMode && (
            <div className="p-2 border-b border-accent/10 bg-surface-overlay/40 flex items-center gap-2 sticky top-0 z-10">
              <input
                value={replaceWith}
                onChange={e => setReplaceWith(e.target.value)}
                placeholder="Replace with…"
                className="flex-1 px-2 py-1 text-xs bg-surface-base border border-accent/20 rounded text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
              />
              <button
                onClick={previewReplace}
                disabled={replacing || !query.trim()}
                className="shrink-0 px-3 py-1 text-xs rounded bg-accent text-white font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {replacing ? '…' : 'Replace All'}
              </button>
            </div>
          )}
          {replaceError && (
            <p className="px-4 py-2 text-xs text-choice-kill italic">{replaceError}</p>
          )}
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
                    <div
                      key={`${h.blockId ?? 'title'}-${h.kind}-${i}`}
                      className="group/hit flex items-start gap-2 px-3 py-2 hover:bg-surface-overlay/40 transition"
                    >
                      <a
                        href={hrefFor(h)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 block"
                      >
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-accent/80 shrink-0">{KIND_LABEL[h.kind]}</span>
                        </div>
                        <p className="text-xs leading-relaxed">{renderSnippet(h)}</p>
                      </a>
                      {replaceMode && h.recordKind !== 'chapter' && (
                        <button
                          onClick={() => replaceSingle(h)}
                          title={`Replace this match with "${replaceWith}"`}
                          className="shrink-0 self-center text-[10px] px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent hover:text-white opacity-0 group-hover/hit:opacity-100 transition"
                        >
                          Replace
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingReplace !== null}
        title={pendingReplace?.total === 0 ? 'No matches to replace' : `Replace ${pendingReplace?.total ?? 0} match${pendingReplace?.total === 1 ? '' : 'es'}?`}
        message={pendingReplace
          ? pendingReplace.total === 0
            ? `Nothing in ${bookFilter.size === 0 ? 'the series' : 'the selected books'} contains "${query.trim()}".`
            : `"${query.trim()}" → "${replaceWith}" across ${[
                pendingReplace.counts.prose && `${pendingReplace.counts.prose} prose`,
                pendingReplace.counts.prompt && `${pendingReplace.counts.prompt} prompt${pendingReplace.counts.prompt === 1 ? '' : 's'}`,
                pendingReplace.counts.choice && `${pendingReplace.counts.choice} choice${pendingReplace.counts.choice === 1 ? '' : 's'}`,
                pendingReplace.counts.override && `${pendingReplace.counts.override} override${pendingReplace.counts.override === 1 ? '' : 's'}`,
              ].filter(Boolean).join(', ')}. This can't be undone.`
          : undefined}
        confirmLabel={pendingReplace?.total === 0 ? 'OK' : 'Replace All'}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          if (pendingReplace?.total === 0) setPendingReplace(null)
          else confirmReplace()
        }}
      />
    </div>
  )
}
