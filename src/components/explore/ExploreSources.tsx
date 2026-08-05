'use client'

import { useMemo, useState } from 'react'
import { LuChevronRight, LuChevronDown, LuExternalLink } from 'react-icons/lu'

import type { Citation } from './types'

// Citations, as WriteAI's CitationCard renders them (LOOM-115).
//
// COLLAPSED by default — WriteAI's own `MessageBubble` opens with
// `useState(false)`, and the two panes should not disagree about the same
// concept. Rank badge, POV pill, chapter, the answer's quote marked inside its
// enclosing sentence, relevance bar.
//
// ⚠️ WriteAI's POV palette could not be copied. It uses Tailwind's `-300` text
// tokens (`text-rose-300`…), tuned for a pane that is always dark; Loom's
// author pages render inside `light-body` and are used in light mode day to
// day, where those wash out to near-invisible. Same six colours, re-derived
// from the same name hash so a character keeps one colour across answers, but
// expressed so they hold at both ends.

const POV_HUES = [350, 205, 265, 38, 172, 300]

function povHue(pov: string): number {
  let h = 0
  for (let i = 0; i < pov.length; i++) h = (h * 31 + pov.charCodeAt(i)) & 0xffff
  return POV_HUES[h % POV_HUES.length]
}

/** Double-quoted spans in the answer. Any that appear verbatim in a chunk get
 *  marked on its card, which is what makes a citation checkable at a glance. */
function quotedSpans(answer: string): string[] {
  const out: string[] = []
  const re = /[“"]([^”"]{12,240})[”"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(answer)) !== null) out.push(m[1].trim())
  return out
}

/** The sentence(s) around the first matching quote, else a sentence-snapped
 *  opening. Mirrors WriteAI's quoteHighlight windowing, kept small. */
function snippetFor(c: Citation, quotes: string[]): { text: string; mark?: [number, number] } {
  const full = c.text || c.snippet || ''
  if (!full) return { text: '' }

  for (const q of quotes) {
    const at = full.indexOf(q)
    if (at === -1) continue
    // Widen to sentence boundaries so the quote reads in context rather than
    // as a fragment starting mid-clause.
    let start = full.lastIndexOf('.', at)
    start = start === -1 ? 0 : start + 1
    let end = full.indexOf('.', at + q.length)
    end = end === -1 ? Math.min(full.length, at + q.length + 120) : end + 1
    const win = full.slice(start, end).trim()
    const rel = win.indexOf(q)
    return rel === -1 ? { text: win } : { text: win, mark: [rel, rel + q.length] }
  }

  const cut = full.slice(0, 220)
  const lastStop = cut.lastIndexOf('.')
  return { text: (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trim() }
}

function relevanceOf(distance: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - distance) * 100)))
}

function CitationCard({
  citation, index, quotes, isActive, onOpen, onOpenChapter,
}: {
  citation: Citation
  index: number
  quotes: string[]
  isActive: boolean
  onOpen: () => void
  onOpenChapter: (() => void) | null
}) {
  const hue = citation.pov ? povHue(citation.pov) : null
  const rel = relevanceOf(citation.distance)
  const snippet = useMemo(() => snippetFor(citation, quotes), [citation, quotes])
  const chapterLabel = citation.chapter === 0 ? 'Prologue' : `Chapter ${citation.chapter}`
  const heading = citation.chapter_heading && citation.chapter_heading !== String(citation.chapter)
    ? ` · “${citation.chapter_heading}”`
    : ''

  const barColor = rel >= 75 ? 'bg-choice-spare' : rel > 50 ? 'bg-choice-amber' : 'bg-choice-kill'

  return (
    <div className={`relative rounded-md border transition-colors ${
      isActive ? 'border-accent' : 'border-accent/15'
    } bg-surface-base`}>
      {onOpenChapter && (
        <button
          type="button"
          onClick={onOpenChapter}
          title="Open this chapter in the editor"
          aria-label="Open this chapter in the editor"
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-overlay hover:text-accent"
        >
          <LuExternalLink size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 py-2.5 pl-3 pr-9 text-left transition-colors hover:bg-surface-overlay"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/15 text-sm font-bold tabular-nums text-accent">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{citation.book}</span>
            {citation.pov && hue !== null && (
              <span
                className="rounded-full px-1.5 py-px text-[9px] font-medium"
                style={{
                  background: `hsl(${hue} 70% 50% / 0.18)`,
                  color: `hsl(${hue} 60% 38%)`,
                  boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 45% / 0.4)`,
                }}
              >
                {citation.pov}
              </span>
            )}
          </span>
          <span className="mt-1 block text-[10px] text-ink-muted">{chapterLabel}{heading}</span>
          {snippet.text && (
            <span className="mt-1.5 block text-[10px] leading-relaxed text-ink-muted">
              {snippet.mark ? (
                <>
                  {snippet.text.slice(0, snippet.mark[0])}
                  <mark className="rounded-sm bg-accent/25 px-0.5 text-ink">
                    {snippet.text.slice(snippet.mark[0], snippet.mark[1])}
                  </mark>
                  {snippet.text.slice(snippet.mark[1])}
                </>
              ) : snippet.text}
            </span>
          )}
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-0.5 w-16 overflow-hidden rounded-full bg-surface-muted">
              <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${rel}%` }} />
            </span>
            <span className="text-[9px] tabular-nums text-ink-faint">{rel}% match</span>
          </span>
        </span>
      </button>
    </div>
  )
}

export default function ExploreSources({
  citations, answer, activeKey, onOpen, onOpenChapterHref,
}: {
  citations: Citation[]
  answer: string
  activeKey: string | null
  onOpen: (c: Citation) => void
  /** Client-side navigation to the chapter, or null when unresolvable.
   *  A FUNCTION rather than an href the card assigns to `window.location`:
   *  that was a full document reload, which threw away the whole panel — the
   *  conversation, the scroll position, the page's own scroll — to move
   *  somewhere Next can route to without a round trip. */
  onOpenChapterHref: (c: Citation) => (() => void) | null
}) {
  const [open, setOpen] = useState(false)
  const quotes = useMemo(() => quotedSpans(answer), [answer])

  if (citations.length === 0) return null

  // Sorted by distance, not by the order the model happened to cite them —
  // the rank badge should mean "closest match", which is what the bar shows.
  const sorted = [...citations].sort((a, b) => a.distance - b.distance)

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-ink transition-colors hover:text-accent"
        >
          {open ? <LuChevronDown size={11} /> : <LuChevronRight size={11} />}
          Sources ({citations.length})
        </button>
        {open && (
          <p className="text-[10px] text-ink-faint">Click a row to read it in context</p>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1.5">
          {sorted.map((c, i) => (
            <CitationCard
              key={`${c.book}__${c.chapter}__${c.chunk_index}`}
              citation={c}
              index={i + 1}
              quotes={quotes}
              isActive={activeKey === `${c.book}__${c.chapter}__${c.chunk_index}`}
              onOpen={() => onOpen(c)}
              onOpenChapter={onOpenChapterHref(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
