// Which summary an outline-board card shows, and whether it can be synced.
//
// The rule the writer set: **a summary she wrote always wins.** WriteAI's
// generated summary is shown only when she has not written one, or when she
// has explicitly chosen it (Sync). Pure, so the precedence is pinned by tests
// rather than re-derived inside a component.
//
// Two sources of "the writer's summary" exist, and both count:
//
//   1. Loom's ChapterSummary row — where every edit on the board now lands.
//   2. A LEGACY edit in WriteAI's own outline card: `writer_summary` that no
//      longer matches the machine's `summary_source`. Before the board moved
//      to Loom, the Outline tab wrote summaries there, and the writer's words
//      must not vanish just because the board stopped writing to that store.
//      Read-only: nothing here ever writes back to WriteAI. The first edit on
//      the board copies it into Loom, and from then on (1) governs.
//
// A ChapterSummary row holding "" is the writer choosing the AI summary — it
// suppresses (2) as well, which is the only reason the row is kept rather
// than deleted.

import type { OutlineCard } from './writerOutline'
import { htmlToParagraphs } from './outlineCards'

/** WriteAI's side of one chapter, keyed by Loom chapter id. */
export type AiSummary = {
  /** The machine-written summary, as HTML, or null when WriteAI has none. */
  aiHtml: string | null
  /** A summary the writer typed into WriteAI's own card, or null. */
  legacyWriterHtml: string | null
}

const text = (html: string | null | undefined) => htmlToParagraphs(html).join(' ').trim()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A stored summary as editor HTML.
 *
 * Summaries written before the board was rich text are plain strings (the
 * Chapters tab stored them that way). Handing one to TipTap raw would collapse
 * its line breaks, so plain text becomes one paragraph per line.
 */
export function summaryToHtml(body: string): string {
  if (/^\s*</.test(body)) return body
  return body
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/** One entry per outline card that is backed by a Loom chapter. */
export function buildAiSummaries(cards: OutlineCard[]): Record<string, AiSummary> {
  const out: Record<string, AiSummary> = {}
  for (const card of cards) {
    if (!card.loom_id) continue
    const source = card.summary_source ?? ''
    const bullets = (card.extracted_bullets ?? []).filter(b => b.trim())
    const aiHtml = text(source)
      ? source
      : bullets.length
        ? `<ul>${bullets.map(b => `<li><p>${escapeHtml(b)}</p></li>`).join('')}</ul>`
        : null
    // Compared as TEXT, not as HTML strings: TipTap re-serialises on load
    // (`&#x27;` → `'`), so an untouched machine summary routinely differs from
    // its source byte-for-byte while saying exactly the same thing.
    const written = text(card.writer_summary)
    const legacyWriterHtml = written && written !== text(source) ? card.writer_summary : null
    out[card.loom_id] = { aiHtml, legacyWriterHtml }
  }
  return out
}

export type ResolvedSummary = {
  /** What the card's editor starts with — HTML, possibly empty. */
  html: string
  /** `ai` earns the "AI generated" badge; `writer` covers both Loom and legacy. */
  source: 'writer' | 'ai' | 'empty'
  /** The card shows the writer's summary AND WriteAI has one to switch to. */
  canSync: boolean
}

export function resolveSummary(manualSummary: string | null, ai: AiSummary | undefined): ResolvedSummary {
  const aiHtml = ai?.aiHtml ?? null
  if (manualSummary !== null && manualSummary.trim() !== '') {
    return { html: summaryToHtml(manualSummary), source: 'writer', canSync: aiHtml !== null }
  }
  if (manualSummary === null && ai?.legacyWriterHtml) {
    return { html: ai.legacyWriterHtml, source: 'writer', canSync: aiHtml !== null }
  }
  if (aiHtml) return { html: aiHtml, source: 'ai', canSync: false }
  return { html: '', source: 'empty', canSync: false }
}
