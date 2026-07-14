'use client'

import { useEffect, useRef, useState, useCallback, type RefObject, type ReactNode } from 'react'
import { LuPlay, LuPause, LuLoaderCircle, LuAudioLines, LuSkipBack, LuSkipForward } from 'react-icons/lu'
import type { WordTiming } from '@/lib/narration/text'
import { wrapWords, nearestBlock } from '@/lib/narration/wrapWords'
import { expandTimes } from '@/lib/narration/tokens'

type Props = {
  // The chapter currently rendered in the reader (null while loading).
  chapterId: string | null
  // The reader's scroll container, so the active word can be kept in view.
  scrollRef: RefObject<HTMLElement | null>
}

type Phase = 'idle' | 'generating' | 'ready' | 'unavailable'
type StatusResponse =
  | { status: 'ready'; audioPath: string; durationMs: number; timing: WordTiming[]; voice: string; blockIds: string[] }
  | { status: 'generating' | 'stale' | 'none' | 'empty' }

const POLL_MS = 2000
const RATES = [1, 1.25, 1.5, 0.75]
// Pressing "back" within this many ms of the current paragraph's start jumps to
// the previous paragraph instead of restarting the current one (so repeated
// presses walk backward), matching how a track "previous" button behaves.
const PARAGRAPH_BACK_GRACE_MS = 1200

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// A transport button with an immediate, styled hover tooltip (the native
// `title` delay makes these icon-only controls easy to misread). The tooltip
// sits below the pill so it never clips against the sticky bar's top edge.
function TooltipButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <div className="relative group shrink-0 flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="w-6 h-6 rounded-full flex items-center justify-center text-ink hover:bg-accent/10 transition"
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface-overlay border border-accent/20 px-2 py-1 text-[11px] text-ink shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-40"
      >
        {label}
      </span>
    </div>
  )
}

export default function NarrationBar({ chapterId, scrollRef }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [posMs, setPosMs] = useState(0)

  const audioRef = useRef<HTMLAudioElement>(null)
  const timesRef = useRef<number[]>([])       // timeMs per word index, for binary search
  const blockIdsRef = useRef<string[]>([])    // narrated block ids, in order, to word-wrap
  const paraStartsRef = useRef<number[]>([])  // word index that begins each paragraph
  const activeRef = useRef(-1)                 // currently highlighted word index
  const rafRef = useRef<number | null>(null)
  // Auto-scroll follows the spoken word, but yields the moment the reader
  // scrolls away by hand — it re-engages only when the active word is back in
  // view (or after an explicit seek), so the reader is never yanked back.
  const followRef = useRef(true)

  // ---- fetch + poll --------------------------------------------------------
  // POST triggers regeneration if the chapter's text changed (the Preview
  // path); then we poll GET until synthesis finishes. Both are idempotent and
  // deduped server-side, so re-entering a chapter is cheap.
  useEffect(() => {
    if (!chapterId) { setPhase('idle'); return }
    let cancelled = false
    setPhase('idle')
    setAudioPath(null)
    setPlaying(false)
    activeRef.current = -1
    followRef.current = true

    ;(async () => {
      try {
        let res = await fetch(`/api/chapters/${chapterId}/narration`, { method: 'POST' })
        let data = (await res.json()) as StatusResponse
        if (data.status === 'generating' || data.status === 'stale' || data.status === 'none') {
          setPhase('generating')
        }
        while (!cancelled && (data.status === 'generating' || data.status === 'stale' || data.status === 'none')) {
          await new Promise(r => setTimeout(r, POLL_MS))
          if (cancelled) return
          res = await fetch(`/api/chapters/${chapterId}/narration`)
          data = (await res.json()) as StatusResponse
        }
        if (cancelled) return
        if (data.status === 'ready') {
          timesRef.current = expandTimes(data.timing, data.durationMs)
          blockIdsRef.current = data.blockIds
          setDurationMs(data.durationMs)
          setAudioPath(data.audioPath)
          setPhase('ready')
        } else {
          // 'empty' → nothing to narrate; anything else here means a failed run.
          setPhase(data.status === 'empty' ? 'idle' : 'unavailable')
        }
      } catch {
        if (!cancelled) setPhase('unavailable')
      }
    })()

    return () => { cancelled = true }
  }, [chapterId])

  // ---- word wrapping -------------------------------------------------------
  // Once audio is ready and the prose is in the DOM, wrap each text block's
  // words continuously so token index N maps to timing[N]. React re-sets the
  // block innerHTML on chapter change, dropping the spans, so this re-runs.
  useEffect(() => {
    if (phase !== 'ready') return
    const raf = requestAnimationFrame(() => {
      let wi = 0
      // Group the wrapped word spans into paragraphs (block-level elements) so
      // the skip controls can jump to paragraph starts. The first span of each
      // new block ancestor, in document order across all narrated containers,
      // begins a paragraph.
      const starts: number[] = []
      let prevBlock: Element | null = null
      for (const id of blockIdsRef.current) {
        const el = document.getElementById(`block-${id}`)
        if (!el) continue
        wi = wrapWords(el, wi)
        el.querySelectorAll<HTMLElement>('.narration-word').forEach(span => {
          const block = nearestBlock(span, el)
          if (block !== prevBlock) { starts.push(Number(span.dataset.wi)); prevBlock = block }
        })
      }
      paraStartsRef.current = starts
      if (wi !== timesRef.current.length) {
        // Non-fatal: sequences drifted (e.g. the reader resolved a conditional
        // fragment to different prose than was narrated). Highlight still runs;
        // it just may lag past the affected block.
        console.warn(`[narration] word count ${wi} ≠ timings ${timesRef.current.length}`)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [phase, chapterId])

  // ---- highlight loop ------------------------------------------------------
  const setActiveWord = useCallback((idx: number) => {
    if (idx === activeRef.current) return
    document.querySelectorAll('.narration-word.is-active').forEach(el => el.classList.remove('is-active'))
    activeRef.current = idx
    if (idx < 0) return
    const els = document.querySelectorAll<HTMLElement>(`.narration-word[data-wi="${idx}"]`)
    els.forEach(el => el.classList.add('is-active'))
    const first = els[0]
    const container = scrollRef.current
    if (!first || !container) return
    const c = container.getBoundingClientRect()
    const e = first.getBoundingClientRect()
    const inView = e.top >= c.top && e.bottom <= c.bottom
    // If the reader scrolled away, don't drag them back — but re-engage the
    // moment the active word is on screen again (they've caught back up).
    if (!followRef.current) {
      if (inView) followRef.current = true
      else return
    }
    // Keep the active word inside a comfortable reading band; only scroll when
    // it leaves it, so playback doesn't jitter the page every word.
    if (e.top < c.top + c.height * 0.2 || e.bottom > c.top + c.height * 0.75) {
      container.scrollTo({ top: container.scrollTop + (e.top - c.top) - c.height * 0.35, behavior: 'smooth' })
    }
  }, [scrollRef])

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
    const tick = () => {
      const a = audioRef.current
      if (a) {
        const ms = a.currentTime * 1000
        setActiveWord(search(ms))
        setPosMs(ms)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing, setActiveWord])

  // ---- click a word to seek ------------------------------------------------
  useEffect(() => {
    if (phase !== 'ready') return
    const container = scrollRef.current
    if (!container) return
    const onClick = (e: MouseEvent) => {
      const span = (e.target as Element).closest<HTMLElement>('.narration-word')
      if (!span?.dataset.wi) return
      const idx = Number(span.dataset.wi)
      const a = audioRef.current
      if (a && timesRef.current[idx] != null) {
        a.currentTime = timesRef.current[idx] / 1000
        followRef.current = true // explicit jump — resume following there
        setActiveWord(idx)
        setPosMs(timesRef.current[idx])
      }
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [phase, scrollRef, setActiveWord])

  // ---- yield auto-scroll to manual scrolling -------------------------------
  // A wheel / touch / scroll-key gesture means the reader wants to look
  // elsewhere; drop follow so setActiveWord stops pulling them back.
  useEffect(() => {
    if (phase !== 'ready') return
    const container = scrollRef.current
    if (!container) return
    const release = () => { followRef.current = false }
    const onKey = (e: KeyboardEvent) => {
      // Plain scroll keys yield follow; modifier combos (the narration hotkeys)
      // don't — they manage follow themselves.
      if (e.altKey || e.metaKey || e.ctrlKey) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) release()
    }
    container.addEventListener('wheel', release, { passive: true })
    container.addEventListener('touchmove', release, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      container.removeEventListener('wheel', release)
      container.removeEventListener('touchmove', release)
      window.removeEventListener('keydown', onKey)
    }
  }, [phase, scrollRef])

  // ---- keyboard shortcuts (⌥⇧ space / arrows) ------------------------------
  useEffect(() => {
    if (phase !== 'ready') return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return
      // Don't hijack keys while typing in a field.
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); jumpParagraph(-1) }
      else if (e.code === 'ArrowRight') { e.preventDefault(); jumpParagraph(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // toggle/jumpParagraph only read refs + durationMs (in deps): no stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, durationMs])

  // Keep the element's rate in sync with the chosen speed.
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate }, [rate, audioPath])

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) { a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) }
  }

  // Jump to a paragraph boundary: back = start of the current paragraph (or the
  // previous one if we're already at its start); forward = start of the next
  // paragraph (or the end of the track past the last one). Treated as an
  // explicit reposition, so auto-follow re-engages at the new spot.
  function jumpParagraph(dir: -1 | 1) {
    const a = audioRef.current
    const starts = paraStartsRef.current
    if (!a || starts.length === 0) return
    const nowMs = a.currentTime * 1000
    const curWi = search(nowMs)
    // Index of the paragraph containing the current word (largest start <= curWi).
    let pi = 0
    for (let i = 0; i < starts.length && starts[i] <= curWi; i++) pi = i

    let targetMs: number
    if (dir < 0) {
      const curStartMs = timesRef.current[starts[pi]] ?? 0
      const toPrev = nowMs - curStartMs < PARAGRAPH_BACK_GRACE_MS && pi > 0
      targetMs = timesRef.current[starts[toPrev ? pi - 1 : pi]] ?? 0
    } else if (pi >= starts.length - 1) {
      targetMs = durationMs // already in the last paragraph — go to the end
    } else {
      targetMs = timesRef.current[starts[pi + 1]] ?? durationMs
    }

    a.currentTime = targetMs / 1000
    followRef.current = true
    setPosMs(targetMs)
    setActiveWord(search(targetMs))
  }

  function seekBar(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current
    if (!a || !durationMs) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    a.currentTime = (durationMs * frac) / 1000
    followRef.current = true // explicit jump — resume following there
    setPosMs(durationMs * frac)
    setActiveWord(search(durationMs * frac))
  }

  if (phase === 'idle') return null

  // A slim pill that sits under the chapter header, styled as a simplified
  // soundtrack block: ghost play button, combined time, a thin progress track.
  // Sticky so it pins to the top of the reading pane on scroll — always within
  // reach to pause/scrub — while still resting between header and body at rest.
  return (
    <div
      className={`sticky top-3 z-30 mx-auto w-2/3 min-w-0 mb-8 h-8 px-4 rounded-full bg-surface-raised border border-accent/10 shadow-sm flex items-center gap-2.5 ${
        phase === 'ready' ? '' : 'justify-center'
      }`}
    >
      {phase === 'generating' && (
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          <LuLoaderCircle size={13} className="animate-spin text-accent" />
          Narration updating…
        </span>
      )}

      {phase === 'unavailable' && (
        <span className="flex items-center gap-2 text-xs text-ink-faint">
          <LuAudioLines size={13} /> Narration unavailable
        </span>
      )}

      {phase === 'ready' && audioPath && (
        <>
          <TooltipButton label="Jump to start of paragraph  ·  ⌥⇧←" onClick={() => jumpParagraph(-1)}>
            <LuSkipBack size={13} />
          </TooltipButton>
          <TooltipButton label={playing ? 'Pause  ·  ⌥⇧Space' : 'Play  ·  ⌥⇧Space'} onClick={toggle}>
            {playing ? <LuPause size={13} /> : <LuPlay size={13} />}
          </TooltipButton>
          <TooltipButton label="Jump to next paragraph  ·  ⌥⇧→" onClick={() => jumpParagraph(1)}>
            <LuSkipForward size={13} />
          </TooltipButton>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint select-none">
            {fmt(posMs)} / {fmt(durationMs)}
          </span>
          <div
            onClick={seekBar}
            className="flex-1 min-w-0 h-1.5 rounded-full bg-accent/10 relative cursor-pointer overflow-hidden"
          >
            <div
              className="absolute left-0 top-0 h-full bg-ink/70 pointer-events-none"
              style={{ width: durationMs ? `${(posMs / durationMs) * 100}%` : '0%' }}
            />
          </div>
          <button
            onClick={() => setRate(r => RATES[(RATES.indexOf(r) + 1) % RATES.length])}
            title="Playback speed"
            className="shrink-0 text-[11px] tabular-nums text-ink-muted hover:text-ink transition w-8 text-right"
          >
            {rate}×
          </button>
          <audio
            ref={audioRef}
            src={audioPath}
            preload="metadata"
            onEnded={() => { setPlaying(false); setActiveWord(-1) }}
          />
        </>
      )}
    </div>
  )
}
