'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LuPause, LuPlay, LuSkipBack, LuSkipForward } from 'react-icons/lu'
import { expandTimes } from '@/shared/narrationTokens'
import { wrapWords, unwrapWords } from '@/shared/wrapWords'

/**
 * The chapter's narration transport, matching Loom's read view: skip back,
 * play/pause, skip forward, elapsed/total, scrubber, speed — plus the word-level
 * highlight that follows the voice through the prose.
 *
 * Follows the page theme rather than staying dark: in Loom's read view this bar
 * sits on the cream page in light mode, not on a dark strip. Only the top nav
 * is always-dark chrome.
 *
 * HOW THE HIGHLIGHT STAYS ALIGNED. Publish stores the reconciled timing next to
 * the audio — one entry per token of the narration text, already realigned
 * against the synthesizer's messy callbacks server-side. This component wraps
 * the SAME tokens in the rendered prose (shared/wrapWords.ts, the identical
 * module Loom's own read view uses) so DOM word N is timing word N, then toggles
 * `.is-active` on rAF. The 1:1 property is the whole thing: it holds only while
 * one definition of "a token" exists, which is why the split rule is shared code
 * rather than a copy.
 *
 * Unlike Loom's, this player has no unlock path — the reader tier's prose is
 * flattened canon and never grows mid-chapter — so the wrap runs once per
 * chapter instead of re-running when a choice reveals more text.
 */

const SPEEDS = [1, 1.25, 1.5, 1.75, 2]

// Highlight the word slightly before it is spoken. Trailing the voice reads as
// lag; anticipating it reads as leading the eye. The progress bar still tracks
// the true position, and the lead scales with playback rate.
const HIGHLIGHT_LEAD_MS = 130

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export type WordTiming = { word: string; timeMs: number }

export default function NarrationBar({
  audioPath,
  durationMs,
  timing,
  blockIds,
}: {
  audioPath: string
  durationMs: number
  /** Reconciled per-token timings from publish. Empty disables the highlight. */
  timing: WordTiming[]
  /** The text blocks to wrap, in reading order — soundtrack rows are not narrated. */
  blockIds: string[]
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)

  // Total time comes from the SNAPSHOT, never from the audio element. The
  // narration track is segments concatenated after the fact, and its header
  // duration is unreliable — `loadedmetadata` reported 0, which rendered as
  // "0:00" beside a chapter that plays for seven minutes. Loom's own player
  // reads durationMs for the same reason (NarrationBar.tsx:495), and seeks
  // against it too, so the scrubber agrees with the clock.
  const totalSec = durationMs / 1000

  const timesRef = useRef<number[]>([])   // timeMs per word index, for binary search
  const activeRef = useRef(-1)
  const followRef = useRef(true)          // auto-scroll, until the reader scrolls away

  useEffect(() => {
    const el = ref.current
    if (el) el.playbackRate = SPEEDS[speedIdx]
  }, [speedIdx])

  // ---- wrap the prose ------------------------------------------------------
  useEffect(() => {
    timesRef.current = expandTimes(timing, durationMs)
    if (timesRef.current.length === 0) return
    const wrapped: HTMLElement[] = []
    // After paint: the block divs are `dangerouslySetInnerHTML`, so their
    // children exist only once React has committed them.
    const raf = requestAnimationFrame(() => {
      let wi = 0
      for (const id of blockIds) {
        const el = document.getElementById(`block-${id}`)
        if (!el) continue
        wrapped.push(el)
        wi = wrapWords(el, wi)
      }
      if (wi !== timesRef.current.length) {
        // Non-fatal, and expected on the chapters whose recording predates a
        // prose edit — publish flags those, and the highlight simply drifts
        // past the changed passage rather than failing.
        console.warn(`[narration] word count ${wi} ≠ timings ${timesRef.current.length}`)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      wrapped.forEach(unwrapWords)
    }
  }, [timing, durationMs, blockIds])

  // ---- highlight loop ------------------------------------------------------
  const setActiveWord = useCallback((idx: number) => {
    if (idx === activeRef.current) return
    document.querySelectorAll('.narration-word.is-active').forEach(el => el.classList.remove('is-active'))
    activeRef.current = idx
    if (idx < 0) return
    const els = document.querySelectorAll<HTMLElement>(`.narration-word[data-wi="${idx}"]`)
    els.forEach(el => el.classList.add('is-active'))
    const first = els[0]
    if (!first) return
    // The reader page scrolls the window, not an inner container.
    const r = first.getBoundingClientRect()
    const h = window.innerHeight
    const inView = r.top >= 0 && r.bottom <= h
    // Don't drag a reader who scrolled ahead back to the voice — but re-engage
    // the moment the active word is on screen again, i.e. they caught up.
    if (!followRef.current) {
      if (inView) followRef.current = true
      else return
    }
    // Keep the active word in a comfortable band; scrolling only when it leaves
    // stops the page jittering on every word.
    if (r.top < h * 0.2 || r.bottom > h * 0.75) {
      window.scrollTo({ top: window.scrollY + r.top - h * 0.35, behavior: 'smooth' })
    }
  }, [])

  const search = (ms: number): number => {
    const t = timesRef.current
    let lo = 0, hi = t.length - 1, idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= ms) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return idx
  }

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = ref.current
      if (a) setActiveWord(search(a.currentTime * 1000 + HIGHLIGHT_LEAD_MS * a.playbackRate))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, setActiveWord])

  // Clear the highlight when the track ends or the component goes away, so a
  // stale word isn't left lit on a paused page.
  useEffect(() => () => setActiveWord(-1), [setActiveWord])

  // ---- click a word to seek ------------------------------------------------
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const span = (e.target as Element).closest<HTMLElement>('.narration-word')
      if (!span?.dataset.wi) return
      const idx = Number(span.dataset.wi)
      const a = ref.current
      const at = timesRef.current[idx]
      if (!a || at == null) return
      a.currentTime = at / 1000
      followRef.current = true // an explicit jump — follow from there
      setActiveWord(idx)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [setActiveWord])

  // ---- yield auto-scroll to manual scrolling -------------------------------
  useEffect(() => {
    const onWheel = () => { followRef.current = false }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchmove', onWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchmove', onWheel)
    }
  }, [])

  const pct = totalSec > 0 ? Math.min(100, (time / totalSec) * 100) : 0

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || totalSec <= 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    el.currentTime = totalSec * frac
    setTime(totalSec * frac)
    followRef.current = true
  }

  const nudge = (by: number) => {
    const el = ref.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(totalSec || el.currentTime + by, el.currentTime + by))
    followRef.current = true
  }

  return (
    <div className="w-full flex items-center gap-3 px-4 py-2 rounded-full bg-surface-raised border border-accent/10">
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
        {clock(time)} / {clock(totalSec)}
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
        onEnded={() => { setPlaying(false); setActiveWord(-1) }}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
      />
    </div>
  )
}
