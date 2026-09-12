import type { Node as PMNode } from '@tiptap/pm/model'

// Match options shared by chapter and series search. Defaults (both false) =
// case-insensitive substring, the historical behaviour.
export type SearchOptions = { caseSensitive?: boolean; wholeWord?: boolean }

const WORD = /[\p{L}\p{N}_]/u
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch)
}

// Fold typographic quotes/apostrophes to their straight ASCII forms so a query
// typed with a keyboard apostrophe (U+0027) matches prose that stores the curly
// one. The editor "educates" quotes on paste/type (see educateQuotes), so
// "shouldn't" is stored as "shouldn't" — without this fold a search for
// "shouldn't" finds nothing. The map is 1-char → 1-char, i.e. LENGTH-PRESERVING,
// so match indices computed against folded text still line up with the original
// (findBlockMatches' posOf mapping and every caller's hay.slice depend on this).
const QUOTES = /[‘’‚‛′“”„‟″]/g
function foldQuotes(s: string): string {
  return s.replace(QUOTES, (c) =>
    c === '“' || c === '”' || c === '„' || c === '‟' || c === '″'
      ? '"'
      : "'",
  )
}

// The editor rewrites a typed `--` into an em dash (the EmDash input rule in
// TextBlock.tsx), so prose the writer typed stores `—` and a search for `--`
// would find nothing. Imported/pasted prose can still hold a literal double
// hyphen, though, so we search BOTH spellings rather than rewriting one into
// the other. Unlike the quote fold this is not length-preserving — `--` (2) vs
// `—` (1) — which is why it lives on the query side only: `hay` is never
// rewritten, so every index below still points at the original text.
function emDashVariant(query: string): string {
  return query.replace(/--/g, '—')
}

// One indexOf sweep for a single spelling of the needle.
function scan(
  hay: string,
  H: string,
  needle: string,
  opts: SearchOptions,
): { index: number; length: number }[] {
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
  const query = foldQuotes(rawQuery.trim())
  if (!query) return []
  // Fold is length-preserving, so indices into `folded` map 1:1 onto `hay` —
  // the word-boundary check below still reads the ORIGINAL flanking chars.
  const folded = foldQuotes(hay)
  const cased = (s: string) => (opts.caseSensitive ? s : s.toLowerCase())
  const H = cased(folded)
  const out = scan(hay, H, cased(query), opts)

  const dashed = emDashVariant(query)
  if (dashed === query) return out
  const extra = scan(hay, H, cased(dashed), opts)
  if (!extra.length) return out
  // Merge the two spellings' hits into one document-ordered list. A hyphen run
  // can satisfy both spellings at overlapping offsets (e.g. `---`), so drop any
  // hit that starts inside one we already kept — the caller's highlight/replace
  // ranges must not overlap.
  const merged = [...out, ...extra].sort((a, b) => a.index - b.index || b.length - a.length)
  const kept: { index: number; length: number }[] = []
  for (const m of merged) {
    const last = kept[kept.length - 1]
    if (last && m.index < last.index + last.length) continue
    kept.push(m)
  }
  return kept
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
