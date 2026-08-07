'use client'

import { useEffect, useRef, useState } from 'react'
import { LuPause, LuPlay, LuSkipBack, LuSkipForward } from 'react-icons/lu'

/**
 * The chapter's narration transport, matching Loom's read view: skip back,
 * play/pause, skip forward, elapsed/total, scrubber, speed.
 *
 * `chrome-dark` because it is chrome — it stays dark in light mode, like the
 * header and the footer rail.
 *
 * Word-level highlighting is NOT here yet. The timing map is published
 * alongside the audio, but wrapping the rendered prose in per-word spans and
 * driving them off playback is its own piece of work; a transport that plays
 * the chapter is the useful half and stands on its own.
 */

const SPEEDS = [1, 1.25, 1.5, 1.75, 2]

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function NarrationBar({ audioPath }: { audioPath: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (el) el.playbackRate = SPEEDS[speedIdx]
  }, [speedIdx])

  const nudge = (by: number) => {
    const el = ref.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + by))
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !Number.isFinite(el.duration)) return
    const r = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - r.left) / r.width) * el.duration
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0

  return (
    <div className="chrome-dark w-full max-w-3xl flex items-center gap-3 px-4 py-2 rounded-full bg-surface-raised border border-accent/10">
      <button onClick={() => nudge(-15)} aria-label="Back 15 seconds" className="p-1 rounded text-ink-muted hover:text-accent transition">
        <LuSkipBack size={13} />
      </button>
      <button
        onClick={() => { const el = ref.current; if (!el) return; el.paused ? void el.play() : el.pause() }}
        aria-label={playing ? 'Pause' : 'Play'}
        className="p-1 rounded text-ink-muted hover:text-accent transition"
      >
        {playing ? <LuPause size={14} /> : <LuPlay size={14} />}
      </button>
      <button onClick={() => nudge(15)} aria-label="Forward 15 seconds" className="p-1 rounded text-ink-muted hover:text-accent transition">
        <LuSkipForward size={13} />
      </button>

      <span className="text-xs text-ink-faint tabular-nums shrink-0">
        {clock(time)} / {clock(duration)}
      </span>

      {/* py-2 gives the 4px bar a usable hit area without thickening it. */}
      <div onClick={seek} className="flex-1 min-w-0 cursor-pointer py-2 group/bar">
        <div className="h-1 rounded-full bg-surface-muted overflow-hidden">
          <div className="h-full bg-accent/60 group-hover/bar:bg-accent transition-colors" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <button
        onClick={() => setSpeedIdx(i => (i + 1) % SPEEDS.length)}
        className="shrink-0 text-xs text-ink-faint hover:text-accent transition tabular-nums w-8 text-right"
      >
        {SPEEDS[speedIdx]}×
      </button>

      <audio
        ref={ref}
        src={audioPath}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
      />
    </div>
  )
}
