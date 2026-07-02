// Plain-text search across a series's prose, choice prompts, choice
// labels, override content, and chapter titles. Linear scan over every
// block — fast enough at single-writer scale (handful of books, tens of
// chapters each) without the FTS5 schema / sync trigger overhead.
//
// Each hit reports its book + chapter + block IDs so the UI can deep-link
// the result row through the same `?block=` mechanism the Context modal
// already uses. Snippet width is bounded so a long paragraph collapses
// to ~120 chars of context centered on the first match.

import { extractTextFromTipTap } from '@/lib/tiptapText'

// What kind of text the hit lives in. The UI shows a small chip per hit
// so the writer can tell "this is the prose" vs "this is the prompt".
export type SearchHitKind = 'prose' | 'prompt' | 'choice' | 'override' | 'chapter-title'

// Precise pointer to the source field a hit came from. The replace-single
// endpoint uses this triple ({recordKind, recordId, field}) to target a
// specific column without re-walking the doc — the search already knew
// exactly where it found the match.
export type RecordKind = 'block' | 'choice' | 'override' | 'chapter'
export type SearchHitField = 'content' | 'baseContent' | 'prompt' | 'label' | 'endingMessage' | 'title'

export type SearchHit = {
  bookId: string
  bookTitle: string
  bookOrder: number
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  // Null for chapter-title hits (no block to anchor to).
  blockId: string | null
  kind: SearchHitKind
  // Field-level addressing so per-hit replace can update exactly the
  // column the match came from. recordKind=chapter / field=title is
  // intentionally not replaceable (chapter renumber cascade lives
  // outside the search-replace flow).
  recordKind: RecordKind
  recordId: string
  field: SearchHitField
  snippet: string         // ~120-char window centered on the match
  matchStart: number      // offset into snippet where the match begins
  matchLength: number     // for the UI to highlight the right span
}

const SNIPPET_RADIUS = 60

function snippetAround(haystack: string, needle: string): { snippet: string; matchStart: number } | null {
  const lower = haystack.toLowerCase()
  const idx = lower.indexOf(needle.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(haystack.length, idx + needle.length + SNIPPET_RADIUS)
  // Collapse internal whitespace so multi-line prose renders as one line.
  const raw = haystack.slice(start, end).replace(/\s+/g, ' ').trim()
  // Recompute match position inside the collapsed slice. Worst case the
  // original whitespace shrinkage shifts the index slightly; we re-find
  // by needle to stay honest.
  const collapsedIdx = raw.toLowerCase().indexOf(needle.toLowerCase())
  const leading = start > 0 ? '…' : ''
  const trailing = end < haystack.length ? '…' : ''
  return {
    snippet: `${leading}${raw}${trailing}`,
    matchStart: leading.length + Math.max(0, collapsedIdx),
  }
}

type Loc = Omit<SearchHit, 'kind' | 'snippet' | 'matchStart' | 'matchLength' | 'blockId' | 'recordKind' | 'recordId' | 'field'>

function emit(
  out: SearchHit[],
  loc: Loc,
  blockId: string | null,
  kind: SearchHitKind,
  record: { recordKind: RecordKind; recordId: string; field: SearchHitField },
  text: string,
  needle: string,
): void {
  if (!text) return
  const found = snippetAround(text, needle)
  if (!found) return
  out.push({
    ...loc,
    blockId,
    kind,
    recordKind: record.recordKind,
    recordId: record.recordId,
    field: record.field,
    snippet: found.snippet,
    matchStart: found.matchStart,
    matchLength: needle.length,
  })
}

type SeriesShape = {
  books: Array<{
    id: string
    title: string
    order: number
    chapters: Array<{
      id: string
      title: string
      order: number
      blocks: Array<{
        id: string
        type: string
        content: string | null
        prompt: string | null
        baseContent: string | null
        choices: Array<{ id: string; label: string; endingMessage: string | null }>
        overrides: Array<{ id: string; content: string; endingMessage: string | null }>
      }>
    }>
  }>
}

export function runSearch(series: SeriesShape, query: string, bookIds: string[] | null): SearchHit[] {
  const needle = query.trim()
  if (!needle) return []
  const out: SearchHit[] = []
  const bookFilter = bookIds && bookIds.length > 0 ? new Set(bookIds) : null

  for (const book of series.books) {
    if (bookFilter && !bookFilter.has(book.id)) continue
    for (const chapter of book.chapters) {
      const loc: Loc = {
        bookId: book.id, bookTitle: book.title, bookOrder: book.order,
        chapterId: chapter.id, chapterTitle: chapter.title, chapterOrder: chapter.order,
      }
      // Chapter title — common "find every chapter named X" search.
      emit(out, loc, null, 'chapter-title',
        { recordKind: 'chapter', recordId: chapter.id, field: 'title' },
        chapter.title, needle)

      for (const block of chapter.blocks) {
        // Prose splits across two block columns. Emit each separately so
        // a per-hit replace targets the right one (text-block prose lives
        // in content; conditional-fragment canon lives in baseContent).
        emit(out, loc, block.id, 'prose',
          { recordKind: 'block', recordId: block.id, field: 'content' },
          extractTextFromTipTap(block.content), needle)
        emit(out, loc, block.id, 'prose',
          { recordKind: 'block', recordId: block.id, field: 'baseContent' },
          extractTextFromTipTap(block.baseContent), needle)

        // Question prompt — plain string field on choice_point blocks.
        emit(out, loc, block.id, 'prompt',
          { recordKind: 'block', recordId: block.id, field: 'prompt' },
          block.prompt ?? '', needle)

        for (const choice of block.choices) {
          emit(out, loc, block.id, 'choice',
            { recordKind: 'choice', recordId: choice.id, field: 'label' },
            choice.label, needle)
          emit(out, loc, block.id, 'choice',
            { recordKind: 'choice', recordId: choice.id, field: 'endingMessage' },
            extractTextFromTipTap(choice.endingMessage), needle)
        }
        for (const override of block.overrides) {
          emit(out, loc, block.id, 'override',
            { recordKind: 'override', recordId: override.id, field: 'content' },
            extractTextFromTipTap(override.content), needle)
          emit(out, loc, block.id, 'override',
            { recordKind: 'override', recordId: override.id, field: 'endingMessage' },
            extractTextFromTipTap(override.endingMessage), needle)
        }
      }
    }
  }
  return out
}
