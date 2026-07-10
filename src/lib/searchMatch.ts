import type { Node as PMNode } from '@tiptap/pm/model'

// Match options shared by chapter and series search. Defaults (both false) =
// case-insensitive substring, the historical behaviour.
export type SearchOptions = { caseSensitive?: boolean; wholeWord?: boolean }

const WORD = /[\p{L}\p{N}_]/u
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch)
}

// Every occurrence of `rawQuery` in `hay`, honouring caseSensitive / wholeWord.
// Whole-word tests the characters flanking the match against a Unicode word
// class, so "cat" doesn't match inside "category" but does inside "the cat.".
// This is the single source of truth both the highlighter and the match-count
// go through, so they can never disagree.
export function matchRanges(
  hay: string,
  rawQuery: string,
  opts: SearchOptions = {},
): { index: number; length: number }[] {
  const query = rawQuery.trim()
  if (!query) return []
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  const H = opts.caseSensitive ? hay : hay.toLowerCase()
  const len = needle.length
  const out: { index: number; length: number }[] = []
  let from = 0
  while (true) {
    const i = H.indexOf(needle, from)
    if (i === -1) break
    // Word-boundary check runs against the ORIGINAL text (case-irrelevant).
    if (!opts.wholeWord || (!isWordChar(hay[i - 1]) && !isWordChar(hay[i + len]))) {
      out.push({ index: i, length: len })
    }
    from = i + len
  }
  return out
}

// Search over a ProseMirror doc that matches ACROSS mark boundaries. Marks
// (bold, italic, character, footnote, colour, …) split a run of prose into
// several adjacent text nodes, so a naive per-text-node scan misses any query
// that straddles a styled span — e.g. "wonderful" when "der" is bold.
//
// We rebuild each textblock's text from its inline children, remembering the
// document position of every character, then run the shared matcher and map
// hits back to { from, to } document ranges. Matching is scoped to a single
// textblock so a match can never span a paragraph break. Non-text inline nodes
// (hard breaks, inline atoms) become a "\n" sentinel — a boundary a query
// can't cross, and a word boundary for whole-word mode.
export function findBlockMatches(
  doc: PMNode,
  query: string,
  opts: SearchOptions = {},
): { from: number; to: number }[] {
  if (!query.trim()) return []
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return // keep descending into container nodes
    let text = ''
    const posOf: number[] = [] // posOf[i] = document position of char i
    node.forEach((child, offset) => {
      const base = pos + 1 + offset
      if (child.isText && child.text) {
        for (let k = 0; k < child.text.length; k++) { text += child.text[k]; posOf.push(base + k) }
      } else {
        text += '\n'; posOf.push(base)
      }
    })
    for (const { index, length } of matchRanges(text, query, opts)) {
      out.push({ from: posOf[index], to: posOf[index + length - 1] + 1 })
    }
    return false // handled this block's inline content; don't descend further
  })
  return out
}
