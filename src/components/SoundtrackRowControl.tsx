'use client'

import { LuPlay, LuPause } from 'react-icons/lu'
import { useSoundtrackPlayer } from '@/lib/soundtrackPlayer'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Per-row play control for a Soundtrack tab playlist. Unlike PinnedAudio
// (which owns its own <audio> element for pin-range preview/editing in the
// chapter editor), this delegates entirely to the shared SoundtrackPlayer —
// clicking play here jumps the ONE shared player to this track and continues
// forward through the rest of the list, rather than playing independently.
export default function SoundtrackRowControl({ trackId, className = '' }: { trackId: string; className?: string }) {
  const { current, isPlaying, currentTime, duration, play, togglePlay, seek } = useSoundtrackPlayer()
  const isActive = current?.id === trackId

  function handlePlayClick() {
    if (isActive) togglePlay()
    else play(trackId)
  }

  function seekFromEvent(clientX: number, target: HTMLDivElement) {
    if (!isActive || !duration) return
    const rect = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seek(ratio * duration)
  }

  const pct = isActive && duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`flex items-center gap-2 h-8 ${className}`}>
      <button
        type="button"
        onClick={handlePlayClick}
        title={isActive && isPlaying ? 'Pause' : 'Play'}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        {isActive && isPlaying ? <LuPause size={14} /> : <LuPlay size={14} />}
      </button>
      <span className="text-[11px] text-ink-faint tabular-nums shrink-0 select-none">
        {isActive ? `${fmt(currentTime)} / ${fmt(duration)}` : ''}
      </span>
      <div
        onMouseDown={e => seekFromEvent(e.clientX, e.currentTarget)}
        className={`flex-1 min-w-0 h-2 rounded-full bg-accent/10 relative overflow-hidden ${isActive ? 'cursor-pointer' : ''}`}
      >
        <div className="absolute top-0 left-0 h-full bg-ink/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
