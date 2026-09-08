'use client'

import { LuShuffle, LuSkipBack, LuPlay, LuPause, LuSkipForward, LuRepeat, LuRepeat1, LuMusic } from 'react-icons/lu'
import { useSoundtrackPlayer, soundtrackRowDomId, soundtrackPopoverRowDomId } from '@/lib/soundtrackPlayer'

function IconButton({ onClick, title, active = false, children }: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition ${
        active ? 'text-accent' : 'text-ink-faint hover:text-ink hover:bg-accent/10'
      }`}
    >
      {children}
    </button>
  )
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Sticky transport bar for a Soundtrack tab, styled after Apple Music's
// hovering mini-player but for light mode: tiny album cover, track/artist,
// transport controls, and a seekable progress bar. `sticky top-0` pins it to
// the top of the tab's own scroll area — the tab content is left in normal
// flow (see SectionTabs), so this needs no portal or layout change to work.
export default function SoundtrackPlayerBar({ compact = false }: { compact?: boolean }) {
  const { tracks, current, isPlaying, shuffle, loopMode, currentTime, duration, play, togglePlay, previous, next, seek, toggleShuffle, cycleLoop } = useSoundtrackPlayer()

  // `|| current` matters in the popover: scoping to a book with no songs
  // empties the queue while a series track is still playing, and hiding the
  // transport there would leave no way to pause it.
  if (tracks.length === 0 && !current) return null

  const display = current ?? tracks[0]
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  function seekFromEvent(clientX: number, target: HTMLDivElement) {
    if (!current || !duration) return
    const rect = target.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seek(ratio * duration)
  }

  // The bar renders in three places now (book tab, series tab, header
  // popover), so "scroll to this song" has to find whichever list is actually
  // up. The popover's copy wins when both are mounted — it's the one the
  // writer is looking at.
  function scrollToDisplayed() {
    const row = document.getElementById(soundtrackPopoverRowDomId(display.id))
      ?? document.getElementById(soundtrackRowDomId(display.id))
    row?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // The header popover is ~1/3 the width this bar was drawn for, and one row
  // of transport + art + title + seek + elapsed does not fit: the time
  // readout — the part you actually watch — is what slides off the end. So the
  // compact variant stacks, which also gives the seek bar the full width
  // rather than whatever the buttons leave over.
  if (compact) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-accent/10 bg-surface-raised px-2.5 py-2">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 w-9 h-9 rounded overflow-hidden flex items-center justify-center bg-surface-overlay">
            {display.albumArtUrl
              ? <img src={display.albumArtUrl} alt="" className="w-full h-full object-cover" />
              : <LuMusic size={14} className="text-accent" />}
          </div>
          <button
            type="button"
            onClick={scrollToDisplayed}
            title="Scroll to this song in the list"
            className="flex-1 min-w-0 text-left"
          >
            <p className="text-sm font-semibold text-ink truncate hover:text-accent transition">{display.name}</p>
            {display.artist && <p className="text-xs text-ink-faint truncate">{display.artist}</p>}
          </button>
          <div className="shrink-0 flex items-center gap-0.5">
            <IconButton onClick={toggleShuffle} title="Shuffle" active={shuffle}><LuShuffle size={13} /></IconButton>
            <IconButton onClick={previous} title="Previous (⌥⇧<)"><LuSkipBack size={15} /></IconButton>
            <button
              type="button"
              onClick={() => (current ? togglePlay() : play())}
              title={`${isPlaying ? 'Pause' : 'Play'} (⌥⇧Space)`}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-accent text-white hover:bg-accent/90 transition"
            >
              {isPlaying ? <LuPause size={14} /> : <LuPlay size={14} className="ml-0.5" />}
            </button>
            <IconButton onClick={next} title="Next (⌥⇧>)"><LuSkipForward size={15} /></IconButton>
            <IconButton onClick={cycleLoop} active={loopMode !== 'off'} title={loopMode === 'off' ? 'Repeat' : loopMode === 'all' ? 'Repeat all (click for repeat one)' : 'Repeat one'}>
              {loopMode === 'one' ? <LuRepeat1 size={13} /> : <LuRepeat size={13} />}
            </IconButton>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            onMouseDown={e => seekFromEvent(e.clientX, e.currentTarget)}
            className="flex-1 min-w-0 h-1.5 rounded-full bg-accent/10 relative cursor-pointer overflow-hidden"
          >
            <div className="absolute top-0 left-0 h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-ink-faint tabular-nums shrink-0 select-none">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="sticky top-0 z-10 mb-1 flex items-center gap-3 rounded-lg border border-accent/10 bg-surface-raised/95 backdrop-blur px-3 py-2 shadow-sm">
      <button
        type="button"
        onClick={toggleShuffle}
        title="Shuffle"
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition ${shuffle ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink hover:bg-accent/10'}`}
      >
        <LuShuffle size={14} />
      </button>
      <button
        type="button"
        onClick={previous}
        title="Previous"
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        <LuSkipBack size={16} />
      </button>
      <button
        type="button"
        onClick={() => (current ? togglePlay() : play())}
        title={isPlaying ? 'Pause' : 'Play'}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-accent text-white hover:bg-accent/90 transition"
      >
        {isPlaying ? <LuPause size={15} /> : <LuPlay size={15} className="ml-0.5" />}
      </button>
      <button
        type="button"
        onClick={next}
        title="Next"
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        <LuSkipForward size={16} />
      </button>
      <button
        type="button"
        onClick={cycleLoop}
        title={loopMode === 'off' ? 'Repeat' : loopMode === 'all' ? 'Repeat all (click for repeat one)' : 'Repeat one'}
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition ${loopMode !== 'off' ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink hover:bg-accent/10'}`}
      >
        {loopMode === 'one' ? <LuRepeat1 size={14} /> : <LuRepeat size={14} />}
      </button>

      <div className="shrink-0 w-9 h-9 rounded overflow-hidden flex items-center justify-center bg-surface-overlay">
        {display.albumArtUrl
          ? <img src={display.albumArtUrl} alt="" className="w-full h-full object-cover" />
          : <LuMusic size={14} className="text-accent" />}
      </div>

      <button
        type="button"
        onClick={scrollToDisplayed}
        title="Scroll to this song in the list"
        className="min-w-0 shrink-0 max-w-[35%] text-left"
      >
        <p className="text-sm font-semibold text-ink truncate hover:text-accent transition">{display.name}</p>
        {display.artist && <p className="text-xs text-ink-faint truncate">{display.artist}</p>}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <div
          onMouseDown={e => seekFromEvent(e.clientX, e.currentTarget)}
          className="flex-1 min-w-0 h-1.5 rounded-full bg-accent/10 relative cursor-pointer overflow-hidden"
        >
          <div className="absolute top-0 left-0 h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] text-ink-faint tabular-nums shrink-0 select-none">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>
    </div>
  )
}
