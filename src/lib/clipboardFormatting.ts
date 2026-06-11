// Shared clipboard formatting for both the reader's "copy chapter" button
// and the editor's native Cmd+C out of any text block. Both flows produce
// the same Charter / 11pt output with novel-style first-line indents and
// a justified default — matches the writer's Pages template.

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

// Per-paragraph style: zero margin (so the destination doesn't stack its
// default Space-After on top of ours), a real first-line indent, and a
// justified default. We deliberately omit `line-height` — Pages ignores
// it on paste, and including it changes spacing in destinations that DO
// honor it. Line spacing is left to the destination's paragraph style,
// which lets a Pages doc set to single-line spacing match Loom output.
//
// Note: Google Docs strips text-indent during paste, so the indent
// shows up only in destinations that respect the CSS attribute
// (Pages, Word, Notion).
export function inlineParagraphStyles(html: string): string {
  // Size goes on the <p> (not the wrapper) because Google Docs reads
  // wrapper font-size through a px→pt conversion (so `11pt` on the
  // wrapper arrives as 14.67pt). Inline on <p> bypasses that path.
  const base = `margin:0;font-size:${PASTE_FONT_SIZE};text-indent:0.25in`
  return html.replace(/<p(\s[^>]*)?>/gi, (_match, attrs: string | undefined) => {
    const a = attrs ?? ''
    const styleMatch = /style\s*=\s*"([^"]*)"/i.exec(a)
    const existing = styleMatch?.[1] ?? ''
    // Default to justify unless the writer set an explicit text-align
    // (center / left / right via the toolbar) — those land in the doc
    // as inline `text-align:` styles, and we don't want to override.
    const hasAlign = /text-align\s*:/i.test(existing)
    const style = hasAlign ? base : `${base};text-align:justify`
    if (styleMatch) {
      return `<p${a.replace(/style\s*=\s*"([^"]*)"/i, (_m, s: string) => `style="${s};${style}"`)}>`
    }
    return `<p${a} style="${style}">`
  })
}

// TipTap leaves trailing/leading <p></p> or <p><br></p> behind editing.
// Drop those, but leave mid-content empty paragraphs alone — those are the
// writer's deliberate blank lines, and they survive to render as a visible
// gap (see the `p:empty` rule on the reader prose container).
export function stripEmptyParagraphs(html: string): string {
  const EMPTY = '<p[^>]*>(?:\\s|<br\\s*\\/?>)*<\\/p>'
  return html
    .replace(new RegExp(`^(?:\\s*${EMPTY})+\\s*`), '')
    .replace(new RegExp(`\\s*(?:${EMPTY}\\s*)+$`), '')
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

// Converts straight quotes/apostrophes to their curly typographic
// equivalents. The editor stores whatever the writer typed (TipTap
// StarterKit doesn't ship a Typography extension), so without this
// pass a pasted manuscript drops out as Bob's instead of Bob's, "hi"
// instead of "hi". Contextual rules:
//   - Single quote between a letter/digit and a letter (Bob's, don't)
//     → right single quote (U+2019)
//   - Single quote after whitespace or an opening bracket (was 'hi)
//     → left single quote (U+2018)
//   - Any other straight single quote → right single quote
//   - Same shape for double quotes (U+201C / U+201D)
export function educateQuotes(s: string): string {
  return s
    .replace(/([\p{L}\p{N}])'([\p{L}])/gu, '$1’$2')
    .replace(/(^|[\s(\[{])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s(\[{])"/g, '$1“')
    .replace(/"/g, '”')
}

// Walks the HTML's text nodes and educates the quotes inside each one.
// Attribute values (`style="…"`, etc.) are left untouched because the
// walker only visits TEXT nodes. Browser-only — this runs from the
// clipboard handlers, which never execute server-side.
export function educateHtml(html: string): string {
  if (typeof document === 'undefined' || !html) return html
  const div = document.createElement('div')
  div.innerHTML = html
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    node.textContent = educateQuotes(node.textContent ?? '')
  }
  return div.innerHTML
}

// Takes raw HTML (one or more concatenated block fragments) and returns the
// rich-text + plain-text pair to write to the clipboard.
export function buildCharterClipboard(rawHtml: string): { html: string; text: string } {
  const cleaned = inlineParagraphStyles(stripEmptyParagraphs(rawHtml))
  const html = educateHtml(`<div style="font-family:${PASTE_FONT_FAMILY}">${cleaned}</div>`)
  // text is derived from the educated HTML, so curly quotes carry
  // through without a second pass.
  const text = htmlToPlainText(html)
  return { html, text }
}
