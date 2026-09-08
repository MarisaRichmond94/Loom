'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRegisterShortcuts } from '@/lib/shortcuts'
import { parseSoundtrackName } from '@/lib/soundtrackName'

// Shared so the header bar (which scrolls to the current track on click) and
// each row (which needs to be the thing found) agree on the same id.
export function soundtrackRowDomId(trackId: string): string {
  return `soundtrack-track-${trackId}`
}

/** The same id, for the popover's own copy of the list — two lists can be
 *  mounted at once (the series tab behind an open popover), and duplicate DOM
 *  ids make "scroll to the current track" land on whichever comes first. */
export function soundtrackPopoverRowDomId(trackId: string): string {
  return `soundtrack-popover-track-${trackId}`
}

export type SoundtrackTrack = {
  id: string
  name: string
  artist: string | null
  src: string
  albumArtUrl: string | null
  bookId: string
  bookTitle: string
  bookOrder: number
  chapterId: string
  chapterTitle: string
  chapterOrder: number
}

// Apple Music's 3-way cycle: off -> repeat the whole playlist -> repeat just
// the current track -> back to off.
export type LoopMode = 'off' | 'all' | 'one'

/**
 * Which playlist the transport walks. Stored as the writer's *preference*
 * rather than a resolved book id: 'book' means "whatever book I'm in right
 * now", so moving from book 2 to book 3 follows along instead of stranding the
 * queue on the book she left. Falls back to the series list wherever there is
 * no active book (the series page).
 */
export type ScopePref = 'series' | 'book'

const SCOPE_STORAGE_KEY = 'loom-soundtrack-scope'

type SeriesSoundtrackRow = {
  id: string
  title: string | null
  audioPath: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  bookId: string
  bookTitle: string
  bookOrder: number
  hasAlbumArt: boolean
}

type PlayerState = {
  /** The active queue — the scope-filtered list prev/next walks. */
  tracks: SoundtrackTrack[]
  /** Every track in the series, regardless of scope. */
  pool: SoundtrackTrack[]
  current: SoundtrackTrack | null
  isPlaying: boolean
  shuffle: boolean
  loopMode: LoopMode
  currentTime: number
  duration: number
  scopePref: ScopePref
  setScopePref: (pref: ScopePref) => void
  /** The book the writer is in, or null off a book/chapter page. */
  activeBookId: string | null
  /** True while `scopePref` is 'book' AND a book is actually active. */
  scopedToBook: boolean
  /** Re-read the series' soundtrack blocks — the popover calls this on open,
   *  so a song added mid-session appears without a reload. */
  refresh: () => void
  play: (id?: string) => void
  togglePlay: () => void
  previous: () => void
  next: () => void
  seek: (time: number) => void
  toggleShuffle: () => void
  cycleLoop: () => void
}

const SoundtrackPlayerContext = createContext<PlayerState | null>(null)

const SHORTCUT_GROUPS = [
  {
    group: 'Soundtrack',
    items: [
      { keys: '⌥⇧<', label: 'Previous track' },
      { keys: '⌥⇧Space', label: 'Play/Pause' },
      { keys: '⌥⇧>', label: 'Next track' },
    ],
  },
]

// Shuffles a fresh permutation of ids — Fisher-Yates. Regenerated whenever
// shuffle is turned on, not maintained incrementally, so replaying a shuffled
// tab always gives a new order rather than repeating the last session's.
function shuffledIds(ids: string[]): string[] {
  const arr = [...ids]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Owns the single <audio> element for the whole author app, so exactly one
 * track plays at a time no matter how many rows, bars or popovers want to
 * start and stop it.
 *
 * It used to be mounted per Soundtrack tab and died with it, on the reasoning
 * that playback was a tab feature. It isn't — the point is music while
 * WRITING — so it now lives in the author layout, above the page. That
 * placement is load-bearing: Next keeps a layout mounted across client-side
 * navigation within its segment, which is the only reason a song survives
 * walking from chapter to chapter. Anything forcing a full document load (an
 * external link, a hard refresh) still stops the music, unavoidably.
 *
 * It also owns the track list now rather than being handed one. With two
 * playlists (series and current book) and three surfaces rendering rows, one
 * fetched pool here is what keeps both "a single track plays at a time" and
 * "previous/next means something" true at once.
 */
export function SoundtrackPlayerProvider({
  seriesId,
  activeBookId,
  children,
}: {
  seriesId: string
  /** Resolved by the layout from the route — a book page, or a chapter's book. */
  activeBookId: string | null
  children: ReactNode
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [pool, setPool] = useState<SoundtrackTrack[]>([])
  const [scopePref, setScopePrefState] = useState<ScopePref>('book')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [loopMode, setLoopMode] = useState<LoopMode>('off')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const shuffleOrderRef = useRef<string[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCOPE_STORAGE_KEY)
      if (stored === 'series' || stored === 'book') setScopePrefState(stored)
    } catch { /* private mode; the default stands */ }
  }, [])

  const setScopePref = useCallback((pref: ScopePref) => {
    setScopePrefState(pref)
    try { localStorage.setItem(SCOPE_STORAGE_KEY, pref) } catch { /* ignore */ }
  }, [])

  // The series list arrives already ordered book → chapter → position, which
  // is exactly the order a continuous playlist should walk.
  const refresh = useCallback(() => {
    fetch(`/api/series/${seriesId}/soundtracks`)
      .then(res => (res.ok ? res.json() : []))
      .then((rows: SeriesSoundtrackRow[]) => setPool(rows.map(r => ({
        id: r.id,
        ...parseSoundtrackName(r.title),
        src: r.audioPath,
        albumArtUrl: r.hasAlbumArt ? `/music/${r.id}-art.jpg` : null,
        bookId: r.bookId,
        bookTitle: r.bookTitle,
        bookOrder: r.bookOrder,
        chapterId: r.chapterId,
        chapterTitle: r.chapterTitle,
        chapterOrder: r.chapterOrder,
      }))))
      .catch(() => { /* offline or mid-restart; keep whatever we have */ })
  }, [seriesId])

  useEffect(() => { refresh() }, [refresh])

  const scopedToBook = scopePref === 'book' && activeBookId !== null
  const tracks = useMemo(
    () => (scopedToBook ? pool.filter(t => t.bookId === activeBookId) : pool),
    [pool, scopedToBook, activeBookId],
  )

  const trackIds = useMemo(() => tracks.map(t => t.id), [tracks])
  // Resolved against the POOL, not the queue: switching scope mid-song leaves
  // the playing track outside the new queue, and it still has to render in the
  // transport bar rather than blanking out — playback deliberately continues.
  const current = pool.find(t => t.id === currentId) ?? null

  function order(): string[] {
    return shuffle ? shuffleOrderRef.current : trackIds
  }

  const advance = useCallback((step: 1 | -1) => {
    const seq = order()
    if (seq.length === 0) return
    // -1 when the current track isn't in this queue at all (the scope was
    // switched under it); stepping forward from there lands on the queue's
    // first track, which is the sane reading of "next" in that state.
    const idx = currentId ? seq.indexOf(currentId) : -1
    let nextIdx = idx + step
    if (nextIdx < 0 || nextIdx >= seq.length) {
      if (loopMode === 'off') {
        setIsPlaying(false)
        return
      }
      nextIdx = (nextIdx + seq.length) % seq.length
    }
    setCurrentId(seq[nextIdx])
    setIsPlaying(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, shuffle, loopMode, trackIds])

  // Manual skip always moves to a different track regardless of loop mode —
  // only natural end-of-track playback (below) repeats the current one.
  const next = useCallback(() => advance(1), [advance])

  const replayCurrent = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = 0
    setCurrentTime(0)
    a.play().catch(() => {})
  }, [])

  // Media-player convention: previous restarts the current track on the
  // first press; a second press within 1s (an intentional double-tap, not
  // two separate "start over" clicks) skips back to the prior track
  // instead. On the first track (no wrap, loop off) there's nowhere to
  // skip back to, so it just keeps restarting — this is also what fixes
  // the old "wonky" state, where advance(-1) silently stopped playback
  // instead of doing anything visible.
  const lastPreviousAtRef = useRef(0)
  const previous = useCallback(() => {
    const now = Date.now()
    const isDoubleTap = now - lastPreviousAtRef.current < 1000
    lastPreviousAtRef.current = now
    const seq = order()
    const idx = currentId ? seq.indexOf(currentId) : -1
    const hasPriorTrack = idx > 0 || (idx === 0 && loopMode === 'all' && seq.length > 1)
    if (isDoubleTap && hasPriorTrack) {
      advance(-1)
    } else {
      replayCurrent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance, replayCurrent, currentId, shuffle, loopMode, trackIds])

  // timeupdate/loadedmetadata don't depend on component state (everything
  // reads back off the element), but `ended` needs the current loop mode and
  // `next` — a stale closure here would always act on whatever they were on
  // the FIRST mount, not wherever they actually are now.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCurrentTime(a.currentTime)
    const onLoadedMeta = () => setDuration(a.duration || 0)
    const onEnded = () => (loopMode === 'one' ? replayCurrent() : next())
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onLoadedMeta)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onLoadedMeta)
      a.removeEventListener('ended', onEnded)
    }
  }, [next, loopMode, replayCurrent])

  // Swap the source and (re)start playback whenever the current track
  // changes. Play state is otherwise driven by the audio element's own
  // play/pause, mirrored back into isPlaying below.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !current) return
    if (a.src !== current.src) {
      a.src = current.src
      a.currentTime = 0
      setCurrentTime(0)
    }
    if (isPlaying) a.play().catch(() => { /* autoplay denied or unmount race; nothing to do */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [])

  // Whenever a track starts up (fresh pick, skip, or auto-advance), bring its
  // row into view — the user is free to scroll away afterward, this only
  // fires on the track change itself, not on every render/seek/pause.
  //
  // Both list surfaces are optional now: with the player global, most track
  // changes happen with no list mounted at all (mid-chapter, hotkey-driven),
  // and getElementById simply finds nothing. That's the intended no-op.
  useEffect(() => {
    if (!current) return
    for (const domId of [soundtrackPopoverRowDomId(current.id), soundtrackRowDomId(current.id)]) {
      document.getElementById(domId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [current?.id])

  const play = useCallback((id?: string) => {
    const a = audioRef.current
    if (!a) return
    if (id) {
      // Playing a row that isn't in the current queue (a series-tab row while
      // scoped to one book) widens the scope rather than starting a track the
      // transport then can't walk away from.
      if (!trackIds.includes(id) && pool.some(t => t.id === id)) setScopePref('series')
      setCurrentId(id)
      setIsPlaying(true)
      return
    }
    if (!currentId) {
      if (trackIds.length === 0) return
      setCurrentId(trackIds[0])
      setIsPlaying(true)
      return
    }
    a.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, trackIds, pool, setScopePref])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (!currentId) {
      play()
      return
    }
    if (a.paused) a.play().catch(() => {})
    else a.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, play])

  const seek = useCallback((time: number) => {
    const a = audioRef.current
    if (!a || !duration) return
    const clamped = Math.max(0, Math.min(duration, time))
    a.currentTime = clamped
    setCurrentTime(clamped)
  }, [duration])

  const toggleShuffle = useCallback(() => {
    setShuffle(prev => {
      const next = !prev
      if (next) shuffleOrderRef.current = shuffledIds(trackIds)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIds])

  // A shuffled order is a permutation of one specific queue, so it goes stale
  // the moment the queue changes (scope toggled, a song added mid-session).
  // Reshuffle rather than walk a list of ids that are no longer all in play.
  useEffect(() => {
    if (shuffle) shuffleOrderRef.current = shuffledIds(trackIds)
  }, [shuffle, trackIds])

  const cycleLoop = useCallback(() => {
    setLoopMode(prev => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'))
  }, [])

  // F7/F8/F9 are macOS hardware media keys — the OS's media-remote system
  // routes them (as a special event type, not a normal keystroke) to
  // whichever app owns the system "Now Playing" session, so a page's keydown
  // listener can miss them entirely no matter what modifier rides along.
  // ⌥⇧Space / ⌥⇧< / ⌥⇧> are ordinary keystrokes that always reach the focused
  // window, and don't collide with this app's existing ⌥⇧<letter/digit>
  // shortcuts (sidebar toggle, canon save, etc).
  //
  // The comma/period pair replaced ⌥⇧←/→ when the player went global: the
  // arrows are previous/next CHAPTER on the chapter page, which this listener
  // would otherwise fight on every keystroke. Two shortcuts moved aside to
  // make room — the side panel's tab cycling (⌥⇧< / ⌥⇧> → ⌃⇧< / ⌃⇧>) and the
  // chapter page's per-block play/pause (⌥⇧Space → ⌃⇧Space).
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return
      if (e.code === 'Comma') { e.preventDefault(); previous() }
      else if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      else if (e.code === 'Period') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [previous, togglePlay, next])

  useRegisterShortcuts('soundtrack-player', SHORTCUT_GROUPS)

  const value: PlayerState = {
    tracks, pool, current, isPlaying, shuffle, loopMode, currentTime, duration,
    scopePref, setScopePref, activeBookId, scopedToBook, refresh,
    play, togglePlay, previous, next, seek, toggleShuffle, cycleLoop,
  }

  return (
    <SoundtrackPlayerContext.Provider value={value}>
      <audio ref={audioRef} preload="metadata" />
      {children}
    </SoundtrackPlayerContext.Provider>
  )
}

export function useSoundtrackPlayer() {
  const ctx = useContext(SoundtrackPlayerContext)
  if (!ctx) throw new Error('useSoundtrackPlayer must be used within a SoundtrackPlayerProvider')
  return ctx
}
