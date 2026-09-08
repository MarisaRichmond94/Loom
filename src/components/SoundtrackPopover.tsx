'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LuChevronRight, LuMusic, LuPause, LuPlay } from 'react-icons/lu'
import SoundtrackPlayerBar from '@/components/SoundtrackPlayerBar'
import { useSoundtrackPlayer, soundtrackPopoverRowDomId, type SoundtrackTrack } from '@/lib/soundtrackPlayer'
import { useClickOutside } from '@/components/editor/AnchoredPopover'

const COLLAPSED_STORAGE_KEY = 'loom-soundtrack-collapsed-books'

/**
 * The header's soundtrack popover — the series' music, playable from anywhere
 * in the author app rather than only from a Soundtrack tab.
 *
 * It sits beside the project switcher because that is what it is scoped to:
 * this project's songs. The player itself lives in the author layout (see
 * SoundtrackPlayerProvider) — this is only a view onto it, so closing the
 * popover, changing chapter, or switching books never interrupts playback.
 */
export default function SoundtrackPopover() {
  const {
    pool, tracks, current, isPlaying, scopePref, setScopePref, scopedToBook, activeBookId,
    play, togglePlay, refresh,
  } = useSoundtrackPlayer()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const scrolledForRef = useRef<string | null>(null)

  useClickOutside([rootRef], () => setOpen(false), open)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY)
      if (stored) setCollapsed(new Set(JSON.parse(stored) as string[]))
    } catch { /* ignore a malformed or missing value */ }
  }, [])

  function toggleBook(bookId: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      try { localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  // Grouped from the visible queue, so the book scope simply yields one group.
  // The queue is already in book → chapter → position order.
  const books = useMemo(() => {
    const byBook = new Map<string, { bookId: string; bookTitle: string; tracks: SoundtrackTrack[] }>()
    for (const t of tracks) {
      const entry = byBook.get(t.bookId) ?? { bookId: t.bookId, bookTitle: t.bookTitle, tracks: [] }
      entry.tracks.push(t)
      byBook.set(t.bookId, entry)
    }
    return [...byBook.values()]
  }, [tracks])

  // Opening is also the one moment worth re-reading the list: a song added in
  // a chapter since this page loaded should be here.
  useEffect(() => { if (open) refresh() }, [open, refresh])

  // Bring the playing track to the top of the list on open. Deliberately not
  // smooth — this is the initial view, not a movement to watch — and it only
  // touches the list's own scroll box, so it never moves the page behind it.
  // A track inside a collapsed book has no row to scroll to, so open that book
  // first; the effect re-runs once the row exists.
  //
  // scrolledForRef makes this fire once per (open, track) rather than on every
  // `collapsed` change — without it, collapsing the playing track's book while
  // the popover is open would immediately re-expand it, and the writer could
  // never close that one group.
  useEffect(() => {
    if (!open) { scrolledForRef.current = null; return }
    if (!current || scrolledForRef.current === current.id) return
    if (collapsed.has(current.bookId)) {
      if (books.some(b => b.bookId === current.bookId)) toggleBook(current.bookId)
      return
    }
    const row = document.getElementById(soundtrackPopoverRowDomId(current.id))
    const box = listRef.current
    if (!row || !box) return
    scrolledForRef.current = current.id
    box.scrollTop = row.offsetTop - box.offsetTop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.id, collapsed, books])

  const hasMusic = pool.length > 0

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={hasMusic ? 'Soundtrack (⌥⇧Space to play/pause)' : 'No soundtrack yet'}
        aria-label="Soundtrack"
        aria-expanded={open}
        className={`flex items-center justify-center w-7 h-7 rounded transition ${
          open || isPlaying ? 'text-accent' : 'text-ink-faint hover:text-accent'
        }`}
      >
        {isPlaying ? <EqualizerIcon /> : <LuMusic size={14} />}
      </button>

      {open && (
        // w-[26rem]: wide enough for "<song> — <artist>" to survive at the
        // truncation point, narrow enough not to reach the search bar at the
        // laptop widths this header already collapses for.
        <div className="absolute left-0 top-full mt-2 z-50 w-[26rem] rounded-xl border border-accent/20 bg-surface-raised shadow-xl overflow-hidden">
          {!hasMusic ? (
            <p className="px-4 py-6 text-sm text-ink-faint italic text-center">
              No soundtracks yet. Add a soundtrack block in any chapter to see it here.
            </p>
          ) : (
            <>
              <div className="p-2 pb-0"><SoundtrackPlayerBar compact /></div>

              {/* Series / this book. Hidden off a book — with no active book
                  there is no second thing to toggle between, and a dead
                  control reads as broken rather than unavailable. */}
              {activeBookId && (
                <div className="flex items-center gap-1 px-2 pt-2">
                  <ScopeButton active={!scopedToBook} onClick={() => setScopePref('series')} label="Series" />
                  <ScopeButton active={scopedToBook} onClick={() => setScopePref('book')} label="This book" />
                  <span className="ml-auto pr-1 text-[11px] text-ink-faint tabular-nums">
                    {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
                  </span>
                </div>
              )}

              <div ref={listRef} className="mt-2 max-h-[22rem] overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                {tracks.length === 0 ? (
                  <p className="px-2 py-6 text-sm text-ink-faint italic text-center">
                    This book has no soundtrack yet. Switch to Series to hear the rest.
                  </p>
                ) : books.map(({ bookId, bookTitle, tracks: bookTracks }) => {
                  const isCollapsed = collapsed.has(bookId)
                  return (
                    <div key={bookId} className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => toggleBook(bookId)}
                        className="flex items-center gap-1.5 w-full text-left px-1 py-1 rounded text-xs uppercase tracking-widest text-ink-faint hover:text-ink hover:bg-accent/5 transition"
                      >
                        <LuChevronRight
                          size={12}
                          className={`shrink-0 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                        />
                        <span className="truncate">{bookTitle}</span>
                      </button>
                      {!isCollapsed && bookTracks.map(t => {
                        const isActive = current?.id === t.id
                        return (
                          <button
                            key={t.id}
                            id={soundtrackPopoverRowDomId(t.id)}
                            type="button"
                            onClick={() => (isActive ? togglePlay() : play(t.id))}
                            className={`group flex items-center gap-2.5 w-full text-left rounded-lg px-2 py-1.5 transition ${
                              isActive ? 'bg-accent/10' : 'hover:bg-accent/5'
                            }`}
                          >
                            <span className="shrink-0 w-9 h-9 rounded overflow-hidden flex items-center justify-center bg-surface-overlay">
                              {t.albumArtUrl
                                ? <img src={t.albumArtUrl} alt="" className="w-full h-full object-cover" />
                                : <LuMusic size={13} className="text-accent" />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block truncate text-sm text-ink">
                                {t.name}
                                {t.artist && <span className="text-ink-faint"> — {t.artist}</span>}
                              </span>
                              <span className="block truncate text-[11px] text-ink-faint italic">
                                {t.chapterTitle?.trim() || `Chapter ${t.chapterOrder}`}
                              </span>
                            </span>
                            {/* Reserved width, not conditional rendering: a
                                control appearing on hover must not reflow the
                                title it sits beside. */}
                            <span className="shrink-0 w-6 flex items-center justify-center text-accent">
                              {isActive && isPlaying
                                ? <LuPause size={13} />
                                : <LuPlay size={13} className={isActive ? '' : 'opacity-0 group-hover:opacity-100 transition'} />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ScopeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs transition ${
        active ? 'bg-accent text-white' : 'text-ink-faint hover:text-ink hover:bg-accent/10'
      }`}
    >
      {label}
    </button>
  )
}

/** Three bars keeping time — the "something is playing" tell, in place of the
 *  static note. Bars rather than a spinner: a spinner reads as loading. */
function EqualizerIcon() {
  return (
    <span className="flex items-end gap-[2px] h-3.5" aria-hidden>
      <span className="loom-eq-bar w-[3px] rounded-sm bg-current" style={{ animationDelay: '0ms' }} />
      <span className="loom-eq-bar w-[3px] rounded-sm bg-current" style={{ animationDelay: '160ms' }} />
      <span className="loom-eq-bar w-[3px] rounded-sm bg-current" style={{ animationDelay: '320ms' }} />
    </span>
  )
}
