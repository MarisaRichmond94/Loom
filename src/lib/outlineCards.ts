import type { OutlineCard } from './writerOutline'

// Presentation helpers for outline cards (LOOM-96).
//
// Both of these exist because the obvious implementation is wrong in a way that
// is invisible until real data hits it, so both are unit-tested.

/**
 * The label for each card, in position order.
 *
 * The rule, ported from WriteAI's `OutlineView` rather than reinvented:
 *
 *   **A written chapter's number is authoritative.** It belongs to the
 *   manuscript, and the backend re-derives it from Loom's manifest. Nothing on
 *   the client may reassign it — not on render, and not on reorder.
 *
 *   **A planned card continues the sequence** from the preceding chapter, so a
 *   placeholder reads sensibly without renumbering anything written.
 *
 * The tempting version — label by array index — is off by one for every book
 * with a prologue (chapter 0), and off by more for every planned card before it.
 * WriteAI shipped that bug and fixed it; `OutlineView.tsx:185` carries the note.
 *
 * Prologue is 0 and renders as "Prologue", never "Chapter 0".
 */
export function outlineCardLabels(cards: OutlineCard[]): string[] {
  let lastNumber: number | null = null
  let plannedRun = 0

  return cards.map(card => {
    if (typeof card.chapter === 'number') {
      lastNumber = card.chapter
      plannedRun = 0
      return card.chapter === 0 ? 'Prologue' : `Chapter ${card.chapter}`
    }
    // A run of planned cards keeps counting up from wherever the last written
    // chapter left off, so three placeholders after chapter 12 read 13, 14, 15
    // rather than all claiming to be 13.
    plannedRun += 1
    // Nothing written before it: the sequence starts at 1, since a prologue
    // would have been a card of its own with chapter 0.
    return `Chapter ${(lastNumber ?? 0) + plannedRun}`
  })
}

/** Entities WriteAI's serialiser actually emits. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

/**
 * `writer_summary` HTML → paragraphs of plain text.
 *
 * The field holds markup (`<p>…</p>` with escaped entities) on every card in
 * the live store. This view is read-only, so it renders the TEXT rather than
 * injecting the markup: `dangerouslySetInnerHTML` on a string that arrives from
 * another process is a needless liability when all that is needed is paragraph
 * breaks.
 *
 * Editing is a different problem — LOOM-97 needs a real rich-text editor, and
 * must round-trip the markup rather than flattening it like this.
 */
export function htmlToParagraphs(html: string | null | undefined): string[] {
  if (!html) return []
  return html
    // Paragraph and line breaks become the split points, everything else goes.
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/gi, m => ENTITIES[m.toLowerCase()] ?? m)
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean)
}
