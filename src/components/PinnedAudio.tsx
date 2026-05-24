'use client'

import { useEffect, useRef, useState } from 'react'
import { LuPlay, LuPause, LuVolume2, LuVolumeX } from 'react-icons/lu'

type Props = {
  src: string
  pinStart?: number | null
  pinEnd?: number | null
  className?: string
}

// Custom audio player used wherever a soundtrack track is rendered (editor,
// reader, book page). Replaces the native <audio controls> because the native
// progress bar can't be visually augmented with a highlighted pin segment.
// Default mode plays the full track; when a pin is set the writer/reader can
// toggle "Pin only" to clamp playback to [pinStart, pinEnd].
export default function PinnedAudio({ src, pinStart, pinEnd, className = '' }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [pinMode, setPinMode] = useState(false)

  const hasPin = pinStart != null || pinEnd != null
  const snippetStart = pinStart ?? 0
  // Fall back to duration so callers that only set pinStart still get a valid
  // upper bound once metadata loads. When duration is 0 (pre-load), the pin
  // highlight and clamp logic both short-circuit, so this is safe.
  const snippetEnd = pinEnd ?? duration

  // Wire audio element events. Re-binds when snippet bounds change so the
  // timeupdate handler enforces the latest range while writers edit pin times.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => {
      setCurrentTime(a.currentTime)
      if (pinMode && snippetEnd > snippetStart && a.currentTime >= snippetEnd) {
        a.pause()
        a.currentTime = snippetStart
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onLoadedMeta = () => setDuration(a.duration || 0)
    const onEnded = () => { setPlaying(false); setCurrentTime(a.currentTime) }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('loadedmetadata', onLoadedMeta)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('loadedmetadata', onLoadedMeta)
      a.removeEventListener('ended', onEnded)
    }
  }, [pinMode, snippetEnd, snippetStart])

  // Snap into the snippet when pin mode flips on while the playhead is outside.
  useEffect(() => {
    if (!pinMode) return
    const a = audioRef.current
    if (!a) return
    if (a.currentTime < snippetStart || a.currentTime > snippetEnd) {
      a.currentTime = snippetStart
      setCurrentTime(snippetStart)
    }
  }, [pinMode, snippetStart, snippetEnd])

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      if (pinMode && (a.currentTime < snippetStart || a.currentTime >= snippetEnd)) {
        a.currentTime = snippetStart
      }
      a.play().catch(() => { /* autoplay denied or unmount race; nothing to do */ })
    } else {
      a.pause()
    }
  }

  function toggleMute() {
    const a = audioRef.current
    if (!a) return
    a.muted = !a.muted
    setMuted(a.muted)
  }

  function seekFromEvent(clientX: number, target: HTMLDivElement) {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    let next = ratio * duration
    if (pinMode) next = Math.max(snippetStart, Math.min(snippetEnd, next))
    a.currentTime = next
    setCurrentTime(next)
  }

  function fmt(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const pinStartPct = duration > 0 ? Math.max(0, (snippetStart / duration) * 100) : 0
  const pinEndPct = duration > 0 ? Math.min(100, (snippetEnd / duration) * 100) : 0

  return (
    <div className={`flex items-center gap-2 h-8 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        title={playing ? 'Pause' : 'Play'}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        {playing ? <LuPause size={14} /> : <LuPlay size={14} />}
      </button>
      <span className="text-[11px] text-ink-faint tabular-nums shrink-0 select-none">
        {fmt(currentTime)} / {fmt(duration)}
      </span>
      <div
        onMouseDown={e => seekFromEvent(e.clientX, e.currentTarget)}
        className="flex-1 min-w-0 h-2 rounded-full bg-accent/10 relative cursor-pointer overflow-hidden"
      >
        {hasPin && duration > 0 && pinEndPct > pinStartPct && (
          <div
            className="absolute top-0 h-full bg-accent/30"
            style={{ left: `${pinStartPct}%`, width: `${pinEndPct - pinStartPct}%` }}
          />
        )}
        <div
          className="absolute top-0 left-0 h-full bg-ink/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? 'Unmute' : 'Mute'}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        {muted ? <LuVolumeX size={14} /> : <LuVolume2 size={14} />}
      </button>
      {hasPin && (
        <button
          type="button"
          onClick={() => setPinMode(p => !p)}
          title={pinMode ? 'Restricted to the pinned snippet — click for full track' : 'Click to play just the pinned snippet'}
          className={`shrink-0 text-[11px] uppercase tracking-widest px-2 h-7 rounded transition ${
            pinMode
              ? 'bg-accent text-white'
              : 'text-ink-faint hover:text-ink hover:bg-accent/10'
          }`}
        >
          Pin
        </button>
      )}
    </div>
  )
}
