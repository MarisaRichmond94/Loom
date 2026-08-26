// Builds the string handed to the speech synthesizer alongside a per-character
// map back to ProseMirror document positions, so a `boundary` event's
// `charIndex` can be turned into a decoration range (LOOM: chapter-page
// read-aloud word highlight).
//
// WHY A MAP, RATHER THAN doc.textBetween()
// The spoken string is not the document's text. `substituteVarTemplates`
// rewrites every {{var}} / {{cond ? a : b}} before the text is spoken, so a
// character offset in the spoken string does not agree with an offset in the
// prose the moment a block uses a template. Highlighting off the raw offset
// would drift by the length difference for the rest of the block — silently,
// and only in template blocks, which is the worst way for it to be wrong.
//
// So each spoken character carries the document range it came from:
//   - a literal character maps to its own single-character range
//   - every character of a substituted template maps to the WHOLE {{...}}
//     source range, so the highlight covers the template as one unit
// A spoken word spanning several characters takes the min start / max end,
// which makes a word straddling a mark boundary (<em>glass</em>.) resolve to
// one continuous range for free.

import type { Node as PMNode } from '@tiptap/pm/model'
import { findVarTemplates, substituteVarTemplates } from '@/lib/templateVars'

export type SpokenDoc = {
  /** Exactly the string passed to SpeechSynthesisUtterance. */
  text: string
  /** Document range each spoken character originated from. */
  startPos: number[]
  endPos: number[]
}

/**
 * Document text in `[from, to)` plus a position for each character.
 *
 * Mirrors `doc.textBetween(from, to, ' ')`: a separator is inserted where a
 * block boundary would otherwise glue the last word of one paragraph to the
 * first of the next. The synthesizer treats that separator as a word break, so
 * omitting it would merge two words into one boundary event and cost us an
 * index for every paragraph break — the same failure `wrapWords` documents.
 */
function docText(doc: PMNode, from: number, to: number): { text: string; posOf: number[] } {
  let text = ''
  const posOf: number[] = []
  let pendingSep = false

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const sliceFrom = Math.max(from, pos)
      const sliceTo = Math.min(to, pos + node.nodeSize)
      const str = node.text.slice(sliceFrom - pos, sliceTo - pos)
      if (!str) return
      if (pendingSep && text) {
        text += ' '
        posOf.push(sliceFrom)
      }
      pendingSep = false
      for (let i = 0; i < str.length; i++) {
        text += str[i]
        posOf.push(sliceFrom + i)
      }
      return
    }
    // Any non-text block (a following paragraph, a horizontal rule) ends the
    // current run of prose; the separator is emitted lazily, so a trailing
    // block never appends a dangling space.
    if (node.isBlock && text) pendingSep = true
  })

  return { text, posOf }
}

/**
 * Build the spoken string for `[from, to)` and its position map.
 *
 * `storyState` resolves templates to the same branch the export takes, so what
 * is read aloud matches what a reader would get.
 */
export function buildSpokenDoc(
  doc: PMNode,
  from: number,
  to: number,
  storyState: Record<string, unknown>,
): SpokenDoc {
  const { text: raw, posOf } = docText(doc, from, to)

  const startPos: number[] = []
  const endPos: number[] = []
  let text = ''

  const pushLiteral = (sliceStart: number, sliceEnd: number) => {
    for (let i = sliceStart; i < sliceEnd; i++) {
      text += raw[i]
      startPos.push(posOf[i])
      endPos.push(posOf[i] + 1)
    }
  }

  const matches = findVarTemplates(raw)
  let cursor = 0
  for (const m of matches) {
    pushLiteral(cursor, m.start)
    // Resolve this template alone. `substituteVarTemplates` returns the raw
    // {{...}} unchanged when it cannot resolve (unknown variable, unparseable
    // condition), which is exactly what the speech path already does — so an
    // unresolvable template is spoken and highlighted as its literal source.
    const replacement = substituteVarTemplates(m.raw, storyState, s => s)
    // The whole {{...}} source range, so any word inside the substituted text
    // highlights the template as a unit rather than a meaningless sub-slice.
    const tplStart = posOf[m.start]
    const tplEnd = posOf[m.end - 1] + 1
    for (const ch of replacement) {
      text += ch
      startPos.push(tplStart)
      endPos.push(tplEnd)
    }
    cursor = m.end
  }
  pushLiteral(cursor, raw.length)

  return { text, startPos, endPos }
}

/**
 * Document range for the spoken word at `charIndex`.
 *
 * `charLength` is optional because it is not universally reported (Chrome
 * sends it; other engines send only `charIndex`). Without it the word is taken
 * to run to the next whitespace, which is the same tokenization the
 * synthesizer used to pick the boundary in the first place.
 *
 * Returns null for a boundary that lands on whitespace or past the end, so the
 * caller leaves the previous highlight alone rather than clearing it.
 */
export function wordRangeAt(
  spoken: SpokenDoc,
  charIndex: number,
  charLength?: number,
): { from: number; to: number } | null {
  const { text, startPos, endPos } = spoken
  if (charIndex < 0 || charIndex >= text.length) return null

  let s = charIndex
  while (s < text.length && /\s/.test(text[s])) s++
  if (s >= text.length) return null

  let e = charLength && charLength > 0 ? Math.min(s + charLength, text.length) : s
  if (!charLength || charLength <= 0) {
    while (e < text.length && !/\s/.test(text[e])) e++
  }
  // Trim any trailing whitespace a reported charLength swept in.
  while (e > s && /\s/.test(text[e - 1])) e--
  if (e <= s) return null

  let lo = Infinity
  let hi = -Infinity
  for (let i = s; i < e; i++) {
    if (startPos[i] < lo) lo = startPos[i]
    if (endPos[i] > hi) hi = endPos[i]
  }
  if (lo === Infinity || hi === -Infinity) return null
  return { from: lo, to: hi }
}
