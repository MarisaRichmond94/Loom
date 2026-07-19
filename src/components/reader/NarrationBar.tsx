'use client'

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject, type ReactNode } from 'react'
import { LuPlay, LuPause, LuLoaderCircle, LuAudioLines, LuSkipBack, LuSkipForward } from 'react-icons/lu'
import type { WordTiming } from '@/lib/narration/text'
import type { StoryState } from '@/lib/storyEngine'
import { wrapWords, unwrapWords, nearestBlock } from '@/lib/narration/wrapWords'
import { expandTimes } from '@/lib/narration/tokens'

type Props = {
  // The chapter currently rendered in the reader (null while loading).
  chapterId: string | null
  // The reader's scroll container, so the active word can be kept in view.
  scrollRef: RefObject<HTMLElement | null>
  // The reader's current variable state and answered choices (choicePointId ->
  // choiceId). Narration covers exactly the prose these unlock; when answering a
  // choice grows them, the bar regenerates and resumes into the new prose.
  storyState: StoryState
  answered: Record<string, string>
  // The (state, answered) each in-chapter branch of the next pending choice would
  // produce. Once the current narration is ready, we pre-generate these in the
  // background so that whichever the reader picks resumes instantly.
  prewarm?: { storyState: StoryState; answered: Record<string, string> }[]
}

type Phase = 'idle' | 'generating' | 'ready' | 'unavailable'
type StatusResponse =
  | {
      status: 'ready'
      audioPath: string
      durationMs: number
      timing: WordTiming[]
      voice: string
      blockIds: string[]
      segments: number[]
      endsAtChoice: boolean
    }
  | { status: 'generating' | 'none' | 'empty' | 'error' }

const POLL_MS = 2000

// A short, soft rising two-note chime, synthesized on the fly (no asset) so the
// reader hears that they've reached a choice when narration pauses there.
function playChoiceChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    for (const [freq, at] of [[587.33, 0], [880, 0.13]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.5)
    }
    setTimeout(() => { ctx.close().catch(() => {}) }, 1000)
  } catch { /* audio unavailable — a missing chime is harmless */ }
}
const RATES = [1, 1.25, 1.5, 0.75]
// Highlight the word slightly before its acoustic onset. The engine's per-word
// times are accurate word *starts*, but flipping the highlight exactly at onset
// reads as trailing once render/paint latency is added — a small lead makes the
// highlight anticipate the word, which is what feels "in sync". Scaled by
// playback rate since the delay it compensates is wall-clock, not media, time.
// Tune here if the highlight feels early (lower) or late (raise).
const HIGHLIGHT_LEAD_MS = 130
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

export default function NarrationBar({ chapterId, scrollRef, storyState, answered, prewarm }: Props) {
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
  const segmentsRef = useRef<number[]>([])    // start ms of each unlocked segment
  const endsAtChoiceRef = useRef(false)       // does the track stop at a pending choice?
  const activeRef = useRef(-1)                 // currently highlighted word index
  const rafRef = useRef<number | null>(null)
  // Auto-scroll follows the spoken word, but yields the moment the reader
  // scrolls away by hand — it re-engages only when the active word is back in
  // view (or after an explicit seek), so the reader is never yanked back.
  const followRef = useRef(true)
  // Cross-render bookkeeping for the "a choice unlocked more text" flow: the
  // chapter we last loaded, how many segments that load had, and a pending
  // resume (seek to the first new segment + auto-play) applied once the new
  // audio's metadata loads.
  const prevChapterRef = useRef<string | null>(null)
  const prevSegCountRef = useRef(0)
  const resumeRef = useRef<{ startMs: number; autoplay: boolean } | null>(null)
  // Only auto-play the continuation after a choice if the reader was actually
  // listening — either the audio was still playing when they answered
  // (playingRef), or it had played all the way to the choice and auto-paused
  // there (playedToChoiceRef). If they never started (or had paused), answering
  // must not suddenly start audio.
  const playingRef = useRef(false)
  const playedToChoiceRef = useRef(false)

  // A stable key over everything the narration request depends on besides the
  // chapter, so the effect re-runs when — and only when — the reader unlocks
  // more text (answers a choice) or flips a variable.
  const stateKey = useMemo(() => JSON.stringify({ s: storyState, a: answered }), [storyState, answered])

  // Mirror `playing` into a ref so the async unlock handler can read the live
  // value without depending on it (and re-subscribing).
  useEffect(() => { playingRef.current = playing }, [playing])

  // ---- fetch + poll --------------------------------------------------------
  // POST the reader's state to ensure narration for the prose they've unlocked,
  // then poll the same endpoint until synthesis + stitching finish. A new
  // chapter starts fresh from the top; the same chapter with more unlocked
  // (stateKey changed) resumes into — and auto-plays — the newly-unlocked
  // segment. Requests are deduped + cached server-side, so this is cheap.
  useEffect(() => {
    if (!chapterId) { setPhase('idle'); prevChapterRef.current = null; return }
    const isUnlock = prevChapterRef.current === chapterId
    prevChapterRef.current = chapterId
    let cancelled = false

    if (!isUnlock) {
      setPhase('idle')
      setAudioPath(null)
      setPlaying(false)
      activeRef.current = -1
      followRef.current = true
      prevSegCountRef.current = 0
      resumeRef.current = null
      playedToChoiceRef.current = false
    }

    const post = async (trigger: boolean): Promise<StatusResponse> => {
      const res = await fetch(`/api/chapters/${chapterId}/narration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyState, answered, trigger }),
      })
      return (await res.json()) as StatusResponse
    }

    ;(async () => {
      try {
        const prevSegCount = prevSegCountRef.current
        let data = await post(true)
        if (data.status === 'generating') setPhase('generating')
        while (!cancelled && data.status === 'generating') {
          await new Promise(r => setTimeout(r, POLL_MS))
          if (cancelled) return
          data = await post(false)
        }
        if (cancelled) return
        if (data.status === 'ready') {
          timesRef.current = expandTimes(data.timing, data.durationMs)
          blockIdsRef.current = data.blockIds
          segmentsRef.current = data.segments
          endsAtChoiceRef.current = data.endsAtChoice
          setDurationMs(data.durationMs)
          // On an unlock, queue a resume into the first newly-unlocked segment.
          // Only auto-play if the reader was actually listening (still playing,
          // or had played through to the choice) — otherwise just position the
          // playhead there, ready for when they press play, with no surprise
          // audio. Applied in the audio's onLoadedMetadata once the new (longer)
          // track is loaded.
          if (isUnlock && data.segments.length > prevSegCount) {
            const autoplay = playingRef.current || playedToChoiceRef.current
            resumeRef.current = { startMs: data.segments[prevSegCount] ?? 0, autoplay }
          }
          playedToChoiceRef.current = false
          prevSegCountRef.current = data.segments.length
          setAudioPath(data.audioPath)
          setPhase('ready')
        } else {
          // 'empty' → nothing to narrate; 'error'/'none' → generation failed.
          setPhase(data.status === 'empty' ? 'idle' : 'unavailable')
        }
      } catch {
        if (!cancelled) setPhase('unavailable')
      }
    })()

    return () => { cancelled = true }
    // storyState/answered are captured through stateKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, stateKey])

  // ---- pre-warm the pending choice's branches ------------------------------
  // Once the current narration is ready, kick off (fire-and-forget) generation
  // of the variant each in-chapter branch would produce, so answering resumes
  // with no wait. Fired once per distinct branch set; the server dedupes and
  // caches, so this is cheap and never fights the current track (already ready).
  const prewarmKey = useMemo(() => JSON.stringify(prewarm ?? []), [prewarm])
  const prewarmedRef = useRef<string>('')
  useEffect(() => {
    if (phase !== 'ready' || !chapterId || !prewarm || prewarm.length === 0) return
    if (prewarmedRef.current === prewarmKey) return
    prewarmedRef.current = prewarmKey
    for (const branch of prewarm) {
      fetch(`/api/chapters/${chapterId}/narration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyState: branch.storyState, answered: branch.answered, trigger: true }),
      }).catch(() => {})
    }
    // prewarm captured via prewarmKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chapterId, prewarmKey])

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
        // Strip any prior wrap first so an unlock (blocks React didn't
        // re-render still hold old spans) renumbers continuously from 0.
        unwrapWords(el)
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
    // audioPath changes when the track grows on an unlock — re-wrap then too.
  }, [phase, chapterId, audioPath])

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
        // Lead the highlight slightly (see HIGHLIGHT_LEAD_MS) so it anticipates
        // the spoken word rather than trailing it; the progress bar still tracks
        // the true position.
        setActiveWord(search(ms + HIGHLIGHT_LEAD_MS * a.playbackRate))
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
            onLoadedMetadata={() => {
              // A choice just unlocked more text: seek to the first newly-added
              // segment and pick up playback from there automatically.
              const a = audioRef.current
              const r = resumeRef.current
              if (!a || !r) return
              resumeRef.current = null
              a.currentTime = r.startMs / 1000
              followRef.current = true
              setPosMs(r.startMs)
              setActiveWord(search(r.startMs))
              if (r.autoplay) a.play().then(() => setPlaying(true)).catch(() => {})
            }}
            onEnded={() => {
              setPlaying(false)
              setActiveWord(-1)
              // Narration ends exactly at a pending choice — chime so the reader
              // knows to make their decision. onEnded only fires because it was
              // playing to the end, so remember that they listened all the way to
              // the choice: answering may then resume playback automatically.
              if (endsAtChoiceRef.current) {
                playChoiceChime()
                playedToChoiceRef.current = true
              }
            }}
          />
        </>
      )}
    </div>
  )
}
