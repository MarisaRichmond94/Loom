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

// ---------------------------------------------------------------------------
// Cross-tab sync
//
// A browser can't share one <audio> element between tabs, so the tabs share
// *state* instead: exactly one tab — the owner — holds the element that makes
// sound, and every other tab renders the same header/popover UI from the
// owner's broadcasts and sends commands back over the channel. Pressing pause
// in a follower posts a message; the owner is what actually pauses.
//
// Before this, each tab mounted its own provider and its own element, so two
// open tabs meant two songs playing over each other. Single ownership is what
// fixes that, and showing the state everywhere falls out of it for free.
// ---------------------------------------------------------------------------

const CHANNEL_NAME = 'loom-soundtrack'

/** How often the owner republishes its playhead so followers' scrubbers move.
 *  Deliberately not on `timeupdate` (which fires several times a second) — a
 *  progress bar reading in whole seconds needs nothing finer. */
const TICK_MS = 1000

/** If the owner doesn't answer a command within this long, assume its tab died
 *  without getting to fire `pagehide` (a crash, a force-quit) and take
 *  playback over here instead of leaving the button dead forever. */
const TAKEOVER_MS = 1000

type Snapshot = {
  currentId: string | null
  isPlaying: boolean
  currentTime: number
  duration: number
  shuffle: boolean
  loopMode: LoopMode
  scopePref: ScopePref
}

type Command =
  | { type: 'play'; id?: string }
  | { type: 'togglePlay' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; time: number }

/** Preferences ride their own message rather than a command: they're plain
 *  state every tab can hold, so they don't need an owner to exist and must not
 *  cause one to be claimed (changing scope shouldn't decide which tab makes
 *  sound the next time you press play). */
type PrefPatch = { shuffle?: boolean; loopMode?: LoopMode; scopePref?: ScopePref }

type Message =
  | { type: 'hello'; from: string }
  | { type: 'claim'; from: string }
  | { type: 'bye'; from: string }
  | { type: 'state'; from: string; snapshot: Snapshot }
  | { type: 'cmd'; from: string; cmd: Command }
  | { type: 'pref'; from: string; pref: PrefPatch }

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
  /** True when this tab is the one holding the playing <audio> element. Every
   *  surface renders identically either way; this is here for the few places
   *  that care whether sound is coming from *here*. */
  isPlaybackOwner: boolean
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
      { keys: '⌥⇧M', label: 'Open / close the soundtrack popover' },
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
 * start and stop it — and, since the cross-tab channel above, no matter how
 * many tabs are open either.
 *
 * It used to be mounted per Soundtrack tab and died with it, on the reasoning
 * that playback was a tab feature. It isn't — the point is music while
 * WRITING — so it now lives in the author layout, above the page. That
 * placement is load-bearing: Next keeps a layout mounted across client-side
 * navigation within its segment, which is the only reason a song survives
 * walking from chapter to chapter. Anything forcing a full document load (an
 * external link, a hard refresh) still stops the music in THIS tab — though
 * with the channel in place, another tab still holding the song keeps playing
 * and this one rejoins as a follower on mount.
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

  // This tab's address on the channel. Only ever compared, never displayed, so
  // a random string is enough and there's nothing to keep stable across loads.
  const tabIdRef = useRef('')
  if (!tabIdRef.current) tabIdRef.current = Math.random().toString(36).slice(2)

  const channelRef = useRef<BroadcastChannel | null>(null)
  /** Which tab holds the sounding element, or null when nothing is playing
   *  anywhere. Kept in a ref alongside the state because the channel handler
   *  and the takeover timer both read it outside of a render. */
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const ownerIdRef = useRef<string | null>(null)
  const takeoverRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setOwner = useCallback((id: string | null) => {
    ownerIdRef.current = id
    setOwnerId(id)
  }, [])

  const owns = useCallback(() => ownerIdRef.current !== null && ownerIdRef.current === tabIdRef.current, [])

  const post = useCallback((msg: Message) => {
    channelRef.current?.postMessage(msg)
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCOPE_STORAGE_KEY)
      if (stored === 'series' || stored === 'book') setScopePrefState(stored)
    } catch { /* private mode; the default stands */ }
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

  // Everything the channel handlers need to read at message time, without
  // making the channel itself re-subscribe on every state change.
  const latestRef = useRef({
    currentId, isPlaying, currentTime, duration, shuffle, loopMode, scopePref, pool, trackIds, refresh,
  })
  latestRef.current = {
    currentId, isPlaying, currentTime, duration, shuffle, loopMode, scopePref, pool, trackIds, refresh,
  }

  const postState = useCallback(() => {
    if (!owns()) return
    const s = latestRef.current
    post({
      type: 'state',
      from: tabIdRef.current,
      snapshot: {
        currentId: s.currentId,
        isPlaying: s.isPlaying,
        currentTime: s.currentTime,
        duration: s.duration,
        shuffle: s.shuffle,
        loopMode: s.loopMode,
        scopePref: s.scopePref,
      },
    })
  }, [owns, post])

  const applySnapshot = useCallback((s: Snapshot) => {
    setCurrentId(s.currentId)
    setIsPlaying(s.isPlaying)
    setCurrentTime(s.currentTime)
    setDuration(s.duration)
    setShuffle(s.shuffle)
    setLoopMode(s.loopMode)
    setScopePrefState(s.scopePref)
    // A song added in another tab isn't in our pool yet, and then the header
    // can't name what's playing. Go and get it.
    if (s.currentId && !latestRef.current.pool.some(t => t.id === s.currentId)) latestRef.current.refresh()
  }, [])

  const applyPref = useCallback((p: PrefPatch) => {
    if (p.shuffle !== undefined) setShuffle(p.shuffle)
    if (p.loopMode !== undefined) setLoopMode(p.loopMode)
    if (p.scopePref !== undefined) {
      setScopePrefState(p.scopePref)
      try { localStorage.setItem(SCOPE_STORAGE_KEY, p.scopePref) } catch { /* ignore */ }
    }
  }, [])

  const setScopePref = useCallback((pref: ScopePref) => {
    applyPref({ scopePref: pref })
    post({ type: 'pref', from: tabIdRef.current, pref: { scopePref: pref } })
  }, [applyPref, post])

  const claim = useCallback(() => {
    setOwner(tabIdRef.current)
    post({ type: 'claim', from: tabIdRef.current })
  }, [post, setOwner])

  /** Load this tab's element with whatever the last owner was playing, so a
   *  takeover picks the song up where it left off instead of from silence. */
  const adopt = useCallback(() => {
    const a = audioRef.current
    const s = latestRef.current
    const track = s.pool.find(t => t.id === s.currentId)
    if (!a || !track) return
    a.src = track.src
    a.currentTime = s.currentTime
  }, [])

  // The transport's actual implementations, reached through a ref so
  // `runCommand` can stay stable while they change every render.
  const actionsRef = useRef({
    play: (_id?: string) => {},
    togglePlay: () => {},
    previous: () => {},
    next: () => {},
    seek: (_time: number) => {},
  })

  const runCommand = useCallback((cmd: Command) => {
    const a = actionsRef.current
    switch (cmd.type) {
      case 'play': a.play(cmd.id); break
      case 'togglePlay': a.togglePlay(); break
      case 'previous': a.previous(); break
      case 'next': a.next(); break
      case 'seek': a.seek(cmd.time); break
    }
  }, [])

  /**
   * Every public transport call goes through here: run it locally if we're the
   * owner, hand it to the owner if there is one, or claim ownership and run it
   * if nobody is playing. That last branch is why sound comes out of the tab
   * you pressed play in — and why the browser lets it, since that tab has the
   * user gesture autoplay policy wants.
   */
  const dispatch = useCallback((cmd: Command) => {
    if (owns()) { runCommand(cmd); return }
    if (ownerIdRef.current !== null) {
      post({ type: 'cmd', from: tabIdRef.current, cmd })
      if (takeoverRef.current) clearTimeout(takeoverRef.current)
      takeoverRef.current = setTimeout(() => {
        takeoverRef.current = null
        claim()
        adopt()
        runCommand(cmd)
      }, TAKEOVER_MS)
      return
    }
    claim()
    adopt()
    runCommand(cmd)
  }, [owns, post, claim, adopt, runCommand])

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
  const runNext = useCallback(() => advance(1), [advance])

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
  const runPrevious = useCallback(() => {
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

  const runPlay = useCallback((id?: string) => {
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
    a.play().catch(() => setIsPlaying(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, trackIds, pool, setScopePref])

  const runTogglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (!currentId) {
      runPlay()
      return
    }
    if (a.paused) a.play().catch(() => setIsPlaying(false))
    else a.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, runPlay])

  const runSeek = useCallback((time: number) => {
    const a = audioRef.current
    if (!a || !duration) return
    const clamped = Math.max(0, Math.min(duration, time))
    a.currentTime = clamped
    setCurrentTime(clamped)
  }, [duration])

  actionsRef.current = { play: runPlay, togglePlay: runTogglePlay, previous: runPrevious, next: runNext, seek: runSeek }

  const play = useCallback((id?: string) => dispatch({ type: 'play', id }), [dispatch])
  const togglePlay = useCallback(() => dispatch({ type: 'togglePlay' }), [dispatch])
  const previous = useCallback(() => dispatch({ type: 'previous' }), [dispatch])
  const next = useCallback(() => dispatch({ type: 'next' }), [dispatch])
  const seek = useCallback((time: number) => {
    // Optimistic locally so a follower's scrubber doesn't snap back for the
    // round trip; the owner's next snapshot is the authority either way.
    setCurrentTime(time)
    dispatch({ type: 'seek', time })
  }, [dispatch])

  const toggleShuffle = useCallback(() => {
    const value = !latestRef.current.shuffle
    setShuffle(value)
    post({ type: 'pref', from: tabIdRef.current, pref: { shuffle: value } })
  }, [post])

  const cycleLoop = useCallback(() => {
    const prev = latestRef.current.loopMode
    const value: LoopMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
    setLoopMode(value)
    post({ type: 'pref', from: tabIdRef.current, pref: { loopMode: value } })
  }, [post])

  // A shuffled order is a permutation of one specific queue, so it goes stale
  // the moment the queue changes (scope toggled, a song added mid-session).
  // Reshuffle rather than walk a list of ids that are no longer all in play.
  useEffect(() => {
    if (shuffle) shuffleOrderRef.current = shuffledIds(trackIds)
  }, [shuffle, trackIds])

  // Open the channel once. Every handler it reaches for is a stable callback
  // reading refs, so this subscribes on mount and stays put.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = ch
    ch.onmessage = (e: MessageEvent<Message>) => {
      const msg = e.data
      if (!msg || msg.from === tabIdRef.current) return
      switch (msg.type) {
        case 'hello':
          // A tab just opened. If we're the one playing, tell it what's on so
          // its header paints the equalizer immediately instead of waiting for
          // the next state change.
          if (owns()) postState()
          break
        case 'cmd':
          if (owns()) {
            runCommand(msg.cmd)
            // Answer even when the command changed nothing we publish on (a
            // seek to where the playhead already was): the sender is holding a
            // takeover timer that fires if we look dead. A task, not a
            // microtask, so React has flushed the command's state first.
            setTimeout(postState, 0)
          }
          break
        case 'pref':
          applyPref(msg.pref)
          break
        case 'claim':
        case 'state':
          // Someone else is (or has just become) the tab making sound. If we
          // thought we were, stand down — two elements playing at once is the
          // exact thing this mechanism exists to prevent, and the newest claim
          // wins so a takeover can't deadlock against a tab that comes back.
          if (owns()) audioRef.current?.pause()
          setOwner(msg.from)
          if (msg.type === 'state') applySnapshot(msg.snapshot)
          if (takeoverRef.current) { clearTimeout(takeoverRef.current); takeoverRef.current = null }
          break
        case 'bye':
          // The owner closed. Keep the track on screen but stopped, rather
          // than blanking the header out from under her.
          if (ownerIdRef.current === msg.from) {
            setOwner(null)
            setIsPlaying(false)
          }
          break
      }
    }
    ch.postMessage({ type: 'hello', from: tabIdRef.current } satisfies Message)
    return () => {
      ch.onmessage = null
      ch.close()
      channelRef.current = null
    }
  }, [owns, postState, runCommand, applyPref, applySnapshot, setOwner])

  // `pagehide` rather than `beforeunload`: it fires for the bfcache path too,
  // which `unload` misses entirely on mobile Safari and increasingly elsewhere.
  useEffect(() => {
    const onHide = () => { if (owns()) post({ type: 'bye', from: tabIdRef.current }) }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [owns, post])

  const isPlaybackOwner = ownerId !== null && ownerId === tabIdRef.current

  // Publish on every edge the other tabs render from. `currentTime` is
  // deliberately absent — it changes constantly and rides the tick below.
  useEffect(() => {
    if (isPlaybackOwner) postState()
  }, [isPlaybackOwner, currentId, isPlaying, shuffle, loopMode, duration, scopePref, postState])

  useEffect(() => {
    if (!isPlaybackOwner || !isPlaying) return
    const id = setInterval(postState, TICK_MS)
    return () => clearInterval(id)
  }, [isPlaybackOwner, isPlaying, postState])

  // timeupdate/loadedmetadata don't depend on component state (everything
  // reads back off the element), but `ended` needs the current loop mode and
  // `next` — a stale closure here would always act on whatever they were on
  // the FIRST mount, not wherever they actually are now.
  //
  // All of them are gated on ownership: a follower's element has no source and
  // fires nothing, but a tab that was *just* demoted still holds a loaded one,
  // and its events must not fight the snapshot it's now rendering.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => { if (owns()) setCurrentTime(a.currentTime) }
    const onLoadedMeta = () => { if (owns()) setDuration(a.duration || 0) }
    const onEnded = () => {
      if (!owns()) return
      if (loopMode === 'one') replayCurrent()
      else runNext()
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onLoadedMeta)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onLoadedMeta)
      a.removeEventListener('ended', onEnded)
    }
  }, [runNext, loopMode, replayCurrent, owns])

  // Swap the source and (re)start playback whenever the current track
  // changes. Play state is otherwise driven by the audio element's own
  // play/pause, mirrored back into isPlaying below. Owner-only: in a follower
  // this same state change is just something to draw.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !current || !owns()) return
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
    const onPlay = () => { if (owns()) setIsPlaying(true) }
    const onPause = () => { if (owns()) setIsPlaying(false) }
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [owns])

  // Whenever a track starts up (fresh pick, skip, or auto-advance), bring its
  // row into view — the user is free to scroll away afterward, this only
  // fires on the track change itself, not on every render/seek/pause.
  //
  // Both list surfaces are optional now: with the player global, most track
  // changes happen with no list mounted at all (mid-chapter, hotkey-driven),
  // and getElementById simply finds nothing. That's the intended no-op. It
  // stays per-tab on purpose — a follower shows the new track, but a song
  // changing elsewhere shouldn't yank the scroll position of a tab she isn't
  // looking at the soundtrack in.
  useEffect(() => {
    if (!current) return
    for (const domId of [soundtrackPopoverRowDomId(current.id), soundtrackRowDomId(current.id)]) {
      document.getElementById(domId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [current?.id])

  // macOS Control Center / the hardware media keys talk to whichever app owns
  // the system "Now Playing" session, and `navigator.mediaSession` is how a
  // page becomes that app. Only the owning tab registers — the OS has one
  // session, and a follower claiming it would point the media keys at a tab
  // holding no sound.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const actions: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']
    const clear = () => {
      for (const action of actions) {
        try { ms.setActionHandler(action, null) } catch { /* unsupported action; nothing to clear */ }
      }
    }
    if (!isPlaybackOwner || !current) {
      ms.metadata = null
      ms.playbackState = 'none'
      clear()
      return
    }
    ms.metadata = new MediaMetadata({
      title: current.name,
      artist: current.artist ?? '',
      album: current.bookTitle,
      artwork: current.albumArtUrl ? [{ src: current.albumArtUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
    ms.playbackState = isPlaying ? 'playing' : 'paused'
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekto', d => { if (d.seekTime != null) seek(d.seekTime) }],
    ]
    for (const [action, handler] of handlers) {
      try { ms.setActionHandler(action, handler) } catch { /* browser doesn't support it */ }
    }
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaybackOwner, current?.id, current?.name, isPlaying, togglePlay, previous, next, seek])

  // F7/F8/F9 are macOS hardware media keys — the OS's media-remote system
  // routes them (as a special event type, not a normal keystroke) to
  // whichever app owns the system "Now Playing" session, which is what the
  // mediaSession block above now claims for the owning tab. ⌥⇧Space / ⌥⇧< /
  // ⌥⇧> are ordinary keystrokes that always reach the focused window, and
  // don't collide with this app's existing ⌥⇧<letter/digit> shortcuts
  // (sidebar toggle, canon save, etc) — so they keep working in every tab,
  // follower or not, because they dispatch through the channel like any
  // other press of the transport.
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
    scopePref, setScopePref, activeBookId, scopedToBook, isPlaybackOwner, refresh,
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
