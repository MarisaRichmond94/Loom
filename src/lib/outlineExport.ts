// The outline board as a Markdown download — the writer's own counterpart to
// WriteAI's story bible.
//
// Built in the browser from exactly what the board shows: the same rows, the
// same resolved summaries (hers first, WriteAI's as the fallback), the same
// POV/date/tags. Nothing is fetched and nothing is written, so it works for a
// book WriteAI has never seen — the brand-new book the board exists for.
//
// Always the whole book in Loom's order, never the filtered view: a file named
// "outline" that silently holds four chapters is a broken artifact that looks
// like a working one.

import type { BookChapterRow } from './bookChapterTags'
import type { ResolvedSummary } from './outlineSummaries'

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ',
}

const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/gi, m => ENTITIES[m.toLowerCase()] ?? m)

/**
 * Summary editor HTML as Markdown paragraphs. Only what the summary editor
 * produces — paragraphs, line breaks, lists, bold, italic — survives as
 * formatting; any other tag is dropped and its text kept.
 */
export function summaryHtmlToMarkdown(html: string): string {
  return decode(
    html
      .replace(/<\/?(?:strong|b)>/gi, '**')
      .replace(/<\/?(?:em|i)>/gi, '_')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/(?:ul|ol)>/gi, '\n\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // A list item's own <p> leaves a blank line inside the list; close it up.
    .replace(/^(- .*)\n\n(?=- )/gm, '$1\n')
    .trim()
}

export type OutlineExportInput = {
  bookTitle: string
  rows: BookChapterRow[]
  summaries: Record<string, ResolvedSummary>
  /** WriteAI ids → display names, for the chapter's tags. */
  characterNames: Record<string, string>
  eventNames: Record<string, string>
  /** "2026-10-18" — passed in so the output is deterministic under test. */
  exportedOn: string
}

export function outlineToMarkdown({
  bookTitle, rows, summaries, characterNames, eventNames, exportedOn,
}: OutlineExportInput): string {
  const count = `${rows.length} ${rows.length === 1 ? 'chapter' : 'chapters'}`
  const out = [`# ${bookTitle} — Outline`, '', `_Exported from Loom on ${exportedOn} · ${count}_`]

  for (const row of rows) {
    out.push('', `## ${row.title}`, '')

    const meta = [
      row.pov && `**POV:** ${row.pov}`,
      row.date && `**Date:** ${row.date}`,
    ].filter(Boolean)
    // A tag whose entity no longer resolves is left out rather than printed
    // as a raw `wc-…` id.
    const names = (tags: BookChapterRow['characters'], lookup: Record<string, string>) =>
      tags.map(t => lookup[t.id]).filter(Boolean).join(', ')
    const characters = names(row.characters, characterNames)
    const events = names(row.events, eventNames)
    const lines = [
      meta.length > 0 && meta.join(' · '),
      characters && `**Characters:** ${characters}`,
      events && `**Events:** ${events}`,
    ].filter(Boolean)
    // Two trailing spaces: a Markdown line break, so the lines stay lines.
    if (lines.length > 0) out.push(lines.join('  \n'), '')

    const summary = summaries[row.chapterId]
    const body = summary?.html ? summaryHtmlToMarkdown(summary.html) : ''
    if (!body) {
      out.push('_No summary yet._')
    } else {
      out.push(body)
      if (summary.source === 'ai') out.push('', '_(AI-generated summary)_')
    }
  }

  return out.join('\n') + '\n'
}

/** "The Dark Horse" → "the-dark-horse-outline.md". */
export function outlineFileName(bookTitle: string): string {
  const slug = bookTitle
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'book'}-outline.md`
}
