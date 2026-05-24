// Shared clipboard formatting for both the reader's "copy chapter" button
// and the editor's native Cmd+C out of any text block. Both flows produce
// the same Charter / 11px output with first-line indents preserved.

// Font + size for the rich-text clipboard payload. Most destinations
// (Google Docs, Word, Notion) respect a wrapping element's inline font
// declarations, so each paragraph picks these up via inheritance.
export const PASTE_FONT_FAMILY = "'Charter', Georgia, serif"
// Pages and Google Docs both read incoming pt-unit font sizes through
// a px→pt conversion and then re-display the result (so `11pt` arrives
// as 14.67pt = 11 × 4/3). Sending the size in px directly bypasses
// that re-conversion: 14.6667px is the CSS-spec equivalent of 11pt
// (1pt = 4/3 px) and lands at 11pt in both destinations.
export const PASTE_FONT_SIZE = '11px'
const INDENT = '    ' // four nbsps ≈ a first-line indent

// Zeroes paragraph margin on every <p> and prefixes each with non-breaking
// spaces so destinations that strip text-indent CSS (Google Docs in
// particular) still show novel-style first-line indents. margin:0 keeps
// the destination from stacking its default Space-After on top of ours.
export function inlineParagraphStyles(html: string): string {
  // Size goes here (not on the wrapper) because Google Docs reads
  // wrapper font-size through a px→pt conversion (so `11pt` on the
  // wrapper arrives as 14.67pt). Inline on <p> bypasses that path.
  const style = `margin:0;font-size:${PASTE_FONT_SIZE}`
  return html.replace(/<p(\s[^>]*)?>/gi, (_match, attrs: string | undefined) => {
    const a = attrs ?? ''
    let tag: string
    if (/\bstyle\s*=/.test(a)) {
      tag = `<p${a.replace(/style\s*=\s*"([^"]*)"/i, (_m, s: string) => `style="${s};${style}"`)}>`
    } else {
      tag = `<p${a} style="${style}">`
    }
    return `${tag}${INDENT}`
  })
}

// TipTap leaves trailing/leading <p></p> or <p><br></p> behind editing.
// Drop those so the rich-text destination doesn't render blank lines.
export function stripEmptyParagraphs(html: string): string {
  return html.replace(/<p[^>]*>(?:\s|<br\s*\/?>)*<\/p>/g, '')
}

export function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined' || !html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'])
  let out = ''
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName
    if (tag === 'BR') { out += '\n'; return }
    if (tag === 'HR') { out += '\n\n---\n\n'; return }
    el.childNodes.forEach(walk)
    if (BLOCK.has(tag)) out += '\n\n'
  }
  div.childNodes.forEach(walk)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

// Takes raw HTML (one or more concatenated block fragments) and returns the
// rich-text + plain-text pair to write to the clipboard.
export function buildCharterClipboard(rawHtml: string): { html: string; text: string } {
  const cleaned = inlineParagraphStyles(stripEmptyParagraphs(rawHtml))
  const html = `<div style="font-family:${PASTE_FONT_FAMILY}">${cleaned}</div>`
  const text = htmlToPlainText(html)
  return { html, text }
}
