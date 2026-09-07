'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRegisterShortcuts } from '@/lib/shortcuts'

// Shared so the header bar (which scrolls to the current track on click) and
// each row (which needs to be the thing found) agree on the same id.
export function soundtrackRowDomId(trackId: string): string {
  return `soundtrack-track-${trackId}`
}

export type SoundtrackTrack = {
  id: string
  name: string
  artist: string | null
  src: string
  albumArtUrl: string | null
}

// Apple Music's 3-way cycle: off -> repeat the whole playlist -> repeat just
// the current track -> back to off.
export type LoopMode = 'off' | 'all' | 'one'

type PlayerState = {
  tracks: SoundtrackTrack[]
  current: SoundtrackTrack | null
  isPlaying: boolean
  shuffle: boolean
  loopMode: LoopMode
  currentTime: number
  duration: number
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
      { keys: '⌥⇧←', label: 'Previous track' },
      { keys: '⌥⇧Space', label: 'Play/Pause' },
      { keys: '⌥⇧→', label: 'Next track' },
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

// Owns the single <audio> element for a Soundtrack tab, so exactly one track
// plays at a time no matter how many rows or the header bar all want to
// start/stop it. Scoped to wherever it's mounted — SectionTabs only mounts
// the active tab, so leaving the Soundtrack tab unmounts this provider (and
// its audio + hotkey listener) along with it. That's deliberate: playback
// is a Soundtrack-tab feature, not a cross-app one.
export function SoundtrackPlayerProvider({ tracks, children }: { tracks: SoundtrackTrack[]; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [loopMode, setLoopMode] = useState<LoopMode>('off')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const shuffleOrderRef = useRef<string[]>([])

  const trackIds = useMemo(() => tracks.map(t => t.id), [tracks])
  const current = tracks.find(t => t.id === currentId) ?? null

  function order(): string[] {
    return shuffle ? shuffleOrderRef.current : trackIds
  }

  const advance = useCallback((step: 1 | -1) => {
    const seq = order()
    if (seq.length === 0) return
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

  const play = useCallback((id?: string) => {
    const a = audioRef.current
    if (!a) return
    if (id) {
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
  }, [currentId, trackIds])

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

  const cycleLoop = useCallback(() => {
    setLoopMode(prev => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'))
  }, [])

  // F7/F8/F9 are macOS hardware media keys — the OS's media-remote system
  // routes them (as a special event type, not a normal keystroke) to
  // whichever app owns the system "Now Playing" session, so a page's keydown
  // listener can miss them entirely no matter what modifier rides along.
  // ⌥⇧←/Space/→ are ordinary keystrokes that always reach the focused
  // window, and don't collide with this app's existing ⌥⇧<letter/digit>
  // shortcuts (sidebar toggle, canon save, etc).
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return
      if (e.code === 'ArrowLeft') { e.preventDefault(); previous() }
      else if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      else if (e.code === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [previous, togglePlay, next])

  useRegisterShortcuts('soundtrack-player', SHORTCUT_GROUPS)

  const value: PlayerState = {
    tracks, current, isPlaying, shuffle, loopMode, currentTime, duration,
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
