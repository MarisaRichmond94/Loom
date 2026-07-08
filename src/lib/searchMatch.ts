import type { Node as PMNode } from '@tiptap/pm/model'

// Case-insensitive search over a ProseMirror doc that matches ACROSS mark
// boundaries. Marks (bold, italic, character, footnote, colour, …) split a
// run of prose into several adjacent text nodes, so a naive per-text-node
// `indexOf` misses any query that straddles a styled span — e.g. searching
// "wonderful" when "der" is bold, or "of the" when "the" is italic.
//
// We rebuild each textblock's text from its inline children, remembering the
// document position of every character, then search that continuous string
// and map matches back to { from, to } document ranges. Matching is scoped to
// a single textblock so a match can never span a paragraph break. Non-text
// inline nodes (hard breaks, inline atoms) become a "\n" sentinel — it can't
// occur in a single-line query, so a phrase never matches across one, which
// mirrors the match-count logic that serialises hard breaks to "\n".
export function findBlockMatches(doc: PMNode, query: string): { from: number; to: number }[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return // keep descending into container nodes
    let text = ''
    const posOf: number[] = [] // posOf[i] = document position of char i
    node.forEach((child, offset) => {
      const base = pos + 1 + offset
      if (child.isText && child.text) {
        const lower = child.text.toLowerCase()
        for (let k = 0; k < child.text.length; k++) { text += lower[k]; posOf.push(base + k) }
      } else {
        text += '\n'; posOf.push(base)
      }
    })
    let from = 0
    while (true) {
      const i = text.indexOf(needle, from)
      if (i === -1) break
      out.push({ from: posOf[i], to: posOf[i + needle.length - 1] + 1 })
      from = i + needle.length
    }
    return false // handled this block's inline content; don't descend further
  })
  return out
}
