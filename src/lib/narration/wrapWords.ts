// Client-only. Wraps each whitespace-delimited token of the rendered prose in a
// <span class="narration-word" data-wi="N"> so the read-mode player can toggle
// a highlight on the word currently being spoken.
//
// The synthesizer's willSpeakRange callbacks tokenize on whitespace (verified:
// its tokens match /\S+/ splitting of the same text exactly, punctuation and
// quotes included), so token index N here lines up 1:1 with timing[N]. A token
// that straddles an inline element boundary (e.g. <em>glass</em>.) produces two
// spans sharing the same data-wi — highlighting selects by index, so both light.
// Each whitespace token is further split at em dashes (splitEmDash) so
// "shoulder—hard—shaking" highlights word-by-word; the parallel expandTimes in
// NarrationBar splits the timings the same way, keeping the two 1:1.
//
// Crucial subtlety: the narration text joins paragraphs/blocks with blank lines,
// so the synthesizer treats a paragraph break as a word boundary. The DOM has no
// whitespace *character* there — the break is structural (<p>…</p><p>…</p>) — so
// concatenating text nodes raw would glue the last word of one paragraph to the
// first of the next into a single token, dropping one index per break and
// drifting the highlight. We insert a separator across block / <br> boundaries
// to mirror what the synthesizer saw, while leaving inline splits joined.

import { splitEmDash } from './tokens'

type Range = { start: number; end: number; wi: number }

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'DIV', 'PRE', 'FIGCAPTION',
])

// The nearest block-level ancestor of a node within `root` (or `root` itself).
// Two nodes in the same paragraph share it; nodes in different paragraphs /
// headings / list items do not. Exported so NarrationBar can group the wrapped
// word spans into paragraphs for previous/next-paragraph navigation.
export function nearestBlock(node: Node, root: HTMLElement): Element {
  let el: Element | null = node.parentElement
  while (el && el !== root) {
    if (BLOCK_TAGS.has(el.tagName)) return el
    el = el.parentElement
  }
  return root
}

function rebuildNode(node: Text, base: number, ranges: Range[]): void {
  const text = node.nodeValue ?? ''
  const nodeEnd = base + text.length
  const hits = ranges.filter(r => r.start < nodeEnd && r.end > base)
  if (hits.length === 0) return // whitespace-only gap between tokens — leave as text
  const frag = document.createDocumentFragment()
  let pos = 0 // local offset within this text node
  for (const r of hits) {
    const s = Math.max(r.start, base) - base
    const e = Math.min(r.end, nodeEnd) - base
    if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)))
    const span = document.createElement('span')
    span.className = 'narration-word'
    span.dataset.wi = String(r.wi)
    span.textContent = text.slice(s, e)
    frag.appendChild(span)
    pos = e
  }
  if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)))
  node.parentNode?.replaceChild(frag, node)
}

// Wrap tokens in `root`, numbering continuously from `startWi`. Returns the next
// free index so callers can wrap several block containers into one sequence.
export function wrapWords(root: HTMLElement, startWi: number): number {
  if (root.querySelector('.narration-word')) return startWi // already wrapped

  // Walk text nodes and <br>s in document order. `sepBefore[i]` marks a text
  // node that a block boundary or line break separates from the previous one.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const nodes: Text[] = []
  const sepBefore: boolean[] = []
  let pendingSep = false
  let prevBlock: Element | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if ((n as Element).tagName === 'BR') pendingSep = true
      continue
    }
    const t = n as Text
    if (!t.nodeValue) continue
    const block = nearestBlock(t, root)
    if (prevBlock !== null && block !== prevBlock) pendingSep = true
    nodes.push(t)
    sepBefore.push(pendingSep)
    pendingSep = false
    prevBlock = block
  }
  if (nodes.length === 0) return startWi

  // Build the global stream, inserting a newline where a boundary would
  // otherwise let two words merge. The separator belongs to no node; since it's
  // whitespace, /\S+/ never puts it in a token, so no rebuild needs to emit it.
  let global = ''
  const bases: number[] = []
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0 && sepBefore[i]) global += '\n'
    bases.push(global.length)
    global += nodes[i].nodeValue
  }

  const ranges: Range[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  let wi = startWi
  while ((m = re.exec(global)) !== null) {
    // Sub-split each whitespace token at em dashes so its words highlight
    // individually; a token with no em dash yields a single range.
    let off = 0
    for (const part of splitEmDash(m[0])) {
      ranges.push({ start: m.index + off, end: m.index + off + part.length, wi: wi++ })
      off += part.length
    }
  }
  for (let i = 0; i < nodes.length; i++) rebuildNode(nodes[i], bases[i], ranges)
  return wi
}
