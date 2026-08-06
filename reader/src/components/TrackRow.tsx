'use client'

import { useEffect, useRef, useState } from 'react'
import { LuMusic, LuPause, LuPlay, LuVolume2, LuVolumeX } from 'react-icons/lu'

/**
 * One soundtrack row: index, art, title, transport, scrubber, mute.
 *
 * A custom player rather than `<audio controls>` because the native widget
 * cannot be laid out — it is a single opaque box whose size and chrome the
 * browser owns, and it looks nothing like the rest of the page in either theme.
 */

/**
 * Every mounted player, so starting one can stop the others.
 *
 * Separate <audio> elements play over each other by default, which on a
 * soundtrack list means two songs at once the first time someone clicks around.
 */
const players = new Set<HTMLAudioElement>()

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function TrackRow({
  index,
  title,
  chapter,
  audioPath,
  artPath,
}: {
  index: number
  title: string
  chapter: string
  audioPath: string
  artPath: string
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [artOk, setArtOk] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    players.add(el)
    return () => { players.delete(el) }
  }, [])

  function toggle() {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      for (const other of players) if (other !== el) other.pause()
      void el.play()
    } else {
      el.pause()
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el || !Number.isFinite(el.duration)) return
    const rect = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
      <span className="w-4 shrink-0 text-xs text-ink-faint tabular-nums text-right">{index}</span>

      <div className="w-11 h-11 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/15 flex items-center justify-center">
        {artOk ? (
          // Album art is `<blockId>-art.jpg` beside the track — a naming
          // convention, so it may simply not exist. Fall back to the note
          // rather than leaving a broken image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artPath}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setArtOk(false)}
          />
        ) : (
          <LuMusic size={14} className="text-ink-faint" />
        )}
      </div>

      <div className="w-56 shrink-0 min-w-0">
        <p className="text-sm text-ink truncate">{title}</p>
        <p className="text-xs text-ink-faint italic truncate">{chapter}</p>
      </div>

      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="shrink-0 p-1.5 rounded text-ink-muted hover:text-accent hover:bg-accent/10 transition"
      >
        {playing ? <LuPause size={14} /> : <LuPlay size={14} />}
      </button>

      <span className="shrink-0 text-xs text-ink-faint tabular-nums">
        {clock(time)} / {clock(duration)}
      </span>

      {/* py-2 gives the 4px bar a comfortable hit area without making it look
          thicker — a 4px click target is a frustrating scrubber. */}
      <div onClick={seek} className="flex-1 min-w-0 cursor-pointer py-2 group/bar">
        <div className="h-1 rounded-full bg-surface-overlay overflow-hidden">
          <div className="h-full bg-accent/60 group-hover/bar:bg-accent transition-colors" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <button
        onClick={() => {
          const el = ref.current
          if (!el) return
          el.muted = !el.muted
          setMuted(el.muted)
        }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="shrink-0 p-1.5 rounded text-ink-muted hover:text-accent hover:bg-accent/10 transition"
      >
        {muted ? <LuVolumeX size={14} /> : <LuVolume2 size={14} />}
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
