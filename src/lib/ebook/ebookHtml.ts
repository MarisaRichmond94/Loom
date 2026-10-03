import { Window } from 'happy-dom'
import { escapeHtml } from '@/lib/renderRichContent'
import { renderProseHtml } from '@/lib/publish/renderProse'
import type { ManuscriptChapter } from '@/lib/manuscript/walk'

/**
 * The canon walk -> one HTML document that pandoc turns into the EPUB.
 *
 * Prose is rendered by renderProseHtml — the same TipTap renderer the reader
 * tier publishes with — so italics, colors and section breaks come from the
 * manuscript itself. The old pipeline read Pages' "unformatted text" export,
 * which is why none of them survived.
 *
 * The rest of this file adapts that HTML to what pandoc's HTML reader keeps:
 * pandoc has no attributes on paragraphs, so a paragraph-level class or
 * alignment is carried on a wrapping <div>, which it does keep. Spans keep
 * their inline style, which is how text color gets through untouched.
 */

export type EbookChapter = Pick<ManuscriptChapter, 'label' | 'numbered' | 'pov' | 'contents' | 'stateByContent'> & {
  date?: string | null
}

export type EbookHtml = {
  html: string
  /**
   * One per chapter, in order — pandoc can only title a TOC entry with the
   * heading's own text, so these are patched into the nav afterwards.
   */
  tocLabels: string[]
}

/** Used when Settings → Export leaves the section-break text empty. */
export const DEFAULT_SECTION_BREAK = '* * *'

export function chapterHeading(ch: Pick<EbookChapter, 'label' | 'numbered'>): string {
  return ch.numbered ? `${ch.label}.` : ch.label
}

export function chapterTocLabel(ch: Pick<EbookChapter, 'label' | 'pov'>): string {
  const pov = ch.pov?.trim()
  return pov ? `${ch.label} - ${pov}` : ch.label
}

const ALIGN_RE = /text-align:\s*(left|center|right|justify)/

/** True for a color too close to black or white to be a deliberate text color. */
export function isThemeColor(color: string | null | undefined): boolean {
  if (!color) return false
  let rgb: number[] | null = null
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1]
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  } else {
    const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
    if (m) rgb = [m[1], m[2], m[3]].map(Number)
  }
  if (!rgb) return false
  return Math.max(...rgb) < 64 || Math.min(...rgb) > 225
}

/**
 * Rewrites one rendered prose fragment in place. `notes` collects footnote
 * text across the whole book, so footnote ids stay unique.
 */
function adaptProse(body: HTMLElement, sectionBreak: string, notes: string[]): void {
  const doc = body.ownerDocument

  // Section break: an <hr> renders as a rule (or nothing) in most readers.
  // A centered line of text is the book convention and survives every reader.
  for (const hr of Array.from(body.querySelectorAll('hr'))) {
    const div = doc.createElement('div')
    div.className = 'scene-break'
    const p = doc.createElement('p')
    p.textContent = sectionBreak
    div.appendChild(p)
    hr.replaceWith(div)
  }

  // Character tags are an editor affordance; in a book they are just text.
  for (const span of Array.from(body.querySelectorAll('span.character-ref'))) {
    span.replaceWith(...Array.from(span.childNodes))
  }

  // Footnotes: Loom stores the note text on the anchor span. Emit pandoc's own
  // footnote markup, which its HTML reader turns into a real note (a pop-up in
  // Apple Books). The anchor text stays in the sentence; the marker follows it.
  //
  // A footnote is a MARK, so one note over "unusual—*especially* for my
  // brother" arrives as three spans, split wherever another mark starts or
  // stops. Adjacent spans carrying the same note in the same paragraph are one
  // footnote with one marker, placed after the last of them.
  const runs: Element[][] = []
  let prev: { span: Element; note: string; block: Element | null } | null = null
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const span = tn.parentElement?.closest('span[data-footnote]') ?? null
    if (!span) {
      if (tn.textContent?.trim()) prev = null
      continue
    }
    const note = span.getAttribute('data-footnote') ?? ''
    const block = span.closest('p, li, blockquote')
    if (prev && prev.note === note && prev.block === block) {
      const run = runs[runs.length - 1]
      if (run[run.length - 1] !== span) run.push(span)
    } else {
      runs.push([span])
    }
    prev = { span, note, block }
  }
  for (const run of runs) {
    const text = run[0].getAttribute('data-footnote') ?? ''
    if (text.trim()) {
      notes.push(text)
      const n = notes.length
      const ref = doc.createElement('a')
      ref.setAttribute('href', `#fn${n}`)
      ref.setAttribute('class', 'footnote-ref')
      ref.setAttribute('id', `fnref${n}`)
      ref.setAttribute('role', 'doc-noteref')
      const sup = doc.createElement('sup')
      sup.textContent = String(n)
      ref.appendChild(sup)
      run[run.length - 1].after(ref)
    }
  }
  // Any footnote span the walk did not reach (no text inside) still unwraps.
  for (const span of Array.from(body.querySelectorAll('span[data-footnote]'))) {
    span.replaceWith(...Array.from(span.childNodes))
  }

  // Near-black / near-white text colors are editor-theme colors that rode in
  // on pasted text, not a choice — and in a book they are a hazard: the
  // reader's dark theme leaves an explicit color alone, so near-black prose
  // goes invisible on a black page. Real color choices (texts, documents,
  // notes) are mid-tones and are kept exactly.
  for (const span of Array.from(body.querySelectorAll('span[style]'))) {
    const el = span as HTMLElement
    if (!isThemeColor(el.style.color)) continue
    el.style.removeProperty('color')
    if (!el.getAttribute('style')?.trim()) el.replaceWith(...Array.from(el.childNodes))
  }

  // A deliberate blank line. renderProseHtml keeps empty paragraphs inside a
  // block (it only trims a block's leading/trailing ones), but pandoc drops an
  // empty <p> outright — so it gets a non-breaking space to hold the line.
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (p.textContent?.trim() || p.querySelector('img')) continue
    const div = doc.createElement('div')
    div.className = 'blank'
    const filler = doc.createElement('p')
    filler.textContent = ' '
    div.appendChild(filler)
    p.replaceWith(div)
  }

  // Paragraph-level formatting pandoc would otherwise drop.
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (p.parentElement?.classList.contains('blank') || p.parentElement?.classList.contains('scene-break')) continue
    const classes: string[] = []
    if (p.classList.contains('no-indent')) classes.push('no-indent')
    const align = (p.getAttribute('style') ?? '').match(ALIGN_RE)?.[1]
    if (align && align !== 'left' && align !== 'justify') classes.push(`align-${align}`)
    if (!classes.length) continue
    p.removeAttribute('class')
    p.removeAttribute('style')
    const div = doc.createElement('div')
    div.className = classes.join(' ')
    p.replaceWith(div)
    div.appendChild(p)
  }
}

export function buildEbookHtml(opts: {
  bookTitle: string
  chapters: EbookChapter[]
  sectionBreakText?: string
}): EbookHtml {
  const sectionBreak = opts.sectionBreakText?.trim() || DEFAULT_SECTION_BREAK
  const window = new Window()
  const doc = window.document
  const notes: string[] = []
  const parts: string[] = []
  const tocLabels: string[] = []

  try {
    for (const ch of opts.chapters) {
      tocLabels.push(chapterTocLabel(ch))
      parts.push(`<h1 class="chapter">${escapeHtml(chapterHeading(ch))}</h1>`)
      const pov = ch.pov?.trim()
      if (pov) parts.push(`<div class="pov"><p>${escapeHtml(pov)}</p></div>`)
      const date = ch.date?.trim()
      if (date) parts.push(`<div class="date"><p>${escapeHtml(date)}</p></div>`)

      const body = doc.createElement('div')
      // renderProseHtml THROWS on unrenderable prose rather than returning ''.
      // That is wanted here too: an EPUB with a silently empty chapter is
      // worse than no new EPUB, because the old one is left in place.
      body.innerHTML = ch.contents
        .map((json, i) => renderProseHtml(json, ch.stateByContent[i]))
        .join('')
      adaptProse(body as unknown as HTMLElement, sectionBreak, notes)
      parts.push(body.innerHTML)
    }

    if (notes.length) {
      parts.push(
        '<section class="footnotes" role="doc-endnotes"><ol>' +
        notes.map((t, i) =>
          `<li id="fn${i + 1}"><p>${escapeHtml(t)}<a href="#fnref${i + 1}" class="footnote-back" role="doc-backlink">↩︎</a></p></li>`,
        ).join('') +
        '</ol></section>',
      )
    }
  } finally {
    window.close()
  }

  const html =
    '<!DOCTYPE html>\n<html lang="en-US"><head><meta charset="utf-8"/>' +
    `<title>${escapeHtml(opts.bookTitle)}</title></head><body>\n` +
    parts.join('\n') +
    '\n</body></html>\n'
  return { html, tocLabels }
}
