import { substituteVarTemplates } from '@/lib/templateVars'
import type { StoryState } from '@/lib/storyEngine'
import { nearestColorStyle, type TemplateColorStyle } from '@/lib/templateStyles'

// Serializes a TipTap doc JSON string into a sequence of WordprocessingML
// <w:p> elements. Marks map to run properties; footnote marks become real
// footnote references (the note text is collected into `FootnoteCollector`
// and rendered into word/footnotes.xml by the docx builder). {{var}}
// templates are substituted against the story state, same as the reader.

export type FootnoteCollector = { notes: string[] }

export type SerializeOptions = {
  // Text rendered on a horizontal-rule (section break) line. Empty string
  // keeps the break as a small styled gap.
  sectionBreakText: string
  storyState: StoryState
  // The template's "<color> Text" styles. When present, colored text is
  // tagged with the nearest matching named style instead of a raw color
  // override — a uniformly colored paragraph takes the paragraph style,
  // colored spans take the character style.
  colorStyles?: TemplateColorStyle[]
}

type TipTapMark = { type: string; attrs?: Record<string, unknown> }
type TipTapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// TipTap colors arrive as #rgb, #rrggbb, or rgb(r, g, b). OOXML wants a
// bare RRGGBB; anything unparseable is dropped rather than corrupting a run.
export function normalizeColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const hex = s.match(/^#?([0-9a-fA-F]{6})$/)
  if (hex) return hex[1].toLowerCase()
  const short = s.match(/^#?([0-9a-fA-F]{3})$/)
  if (short) return short[1].split('').map(c => c + c).join('').toLowerCase()
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map(n => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0'))
      .join('')
  }
  return null
}

const ALIGN_TO_JC: Record<string, string> = {
  left: 'left', center: 'center', right: 'right', justify: 'both',
}

function markOfType(node: TipTapNode, type: string): TipTapMark | undefined {
  return node.marks?.find(m => m.type === type)
}

function runProps(marks: TipTapMark[] | undefined, opts: SerializeOptions, suppressColor?: string | null): string {
  if (!marks?.length) return ''
  let rStyle = ''  // must precede the toggle/color properties in rPr
  let rpr = ''
  for (const m of marks) {
    if (m.type === 'bold') rpr += '<w:b w:val="1"/>'
    else if (m.type === 'italic') rpr += '<w:i w:val="1"/>'
    else if (m.type === 'underline') rpr += '<w:u w:val="single"/>'
    else if (m.type === 'strike') rpr += '<w:strike w:val="1"/>'
    else if (m.type === 'textStyle') {
      const color = normalizeColor(m.attrs?.color)
      if (!color || color === suppressColor) continue
      const named = opts.colorStyles ? nearestColorStyle(color, opts.colorStyles, 'character') : null
      if (named) rStyle = `<w:rStyle w:val="${escapeXml(named.name)}"/>`
      else rpr += `<w:color w:val="${color}"/>`
    }
    // 'footnote' and 'character' don't style the run itself.
  }
  return (rStyle || rpr) ? `<w:rPr>${rStyle}${rpr}</w:rPr>` : ''
}

function textRun(text: string, marks: TipTapMark[] | undefined, opts: SerializeOptions, suppressColor?: string | null): string {
  const substituted = substituteVarTemplates(text, opts.storyState, s => s)
  if (!substituted) return ''
  return `<w:r>${runProps(marks, opts, suppressColor)}<w:t xml:space="preserve">${escapeXml(substituted)}</w:t></w:r>`
}

function footnoteRefRun(id: number): string {
  return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`
}

// Serialize the inline content of one paragraph-like node. Footnote marks
// can be split across several text nodes by overlapping marks — the
// reference is emitted once, after the last node carrying the same note.
function serializeInline(nodes: TipTapNode[] | undefined, opts: SerializeOptions, footnotes: FootnoteCollector, suppressColor?: string | null): string {
  if (!nodes?.length) return ''
  let out = ''
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === 'hardBreak') { out += '<w:r><w:br/></w:r>'; continue }
    if (node.type !== 'text' || !node.text) continue
    out += textRun(node.text, node.marks, opts, suppressColor)
    const fn = markOfType(node, 'footnote')
    if (fn) {
      const content = String(fn.attrs?.content ?? '')
      const next = nodes[i + 1]
      const nextFn = next ? markOfType(next, 'footnote') : undefined
      const continues = nextFn && String(nextFn.attrs?.content ?? '') === content
      if (!continues && content) {
        footnotes.notes.push(content)
        out += footnoteRefRun(footnotes.notes.length)
      }
    }
  }
  return out
}

function paragraphXml(styleId: string, jc: string | null, inner: string, extraPPr = ''): string {
  const jcXml = jc ? `<w:jc w:val="${jc}"/>` : ''
  return `<w:p><w:pPr><w:pStyle w:val="${escapeXml(styleId)}"/>${extraPPr}${jcXml}</w:pPr>${inner}</w:p>`
}

// TextAlign only serializes an attr when it differs from the default
// ('left'), and the reader justifies by default — so an absent/left attr
// means "inherit the Body style" and anything else is a deliberate override.
function jcOverride(node: TipTapNode): string | null {
  const align = node.attrs?.textAlign
  if (typeof align !== 'string' || align === 'left') return null
  return ALIGN_TO_JC[align] ?? null
}

// The single color shared by every piece of text in the paragraph, or null
// when the paragraph is uncolored / mixed. Only real text weighs in;
// hard breaks don't carry marks.
function uniformParagraphColor(node: TipTapNode): string | null {
  let color: string | null = null
  for (const n of node.content ?? []) {
    if (n.type !== 'text' || !n.text?.trim()) continue
    const c = normalizeColor(n.marks?.find(m => m.type === 'textStyle')?.attrs?.color)
    if (!c) return null
    if (color === null) color = c
    else if (c !== color) return null
  }
  return color
}

function serializeBlock(node: TipTapNode, opts: SerializeOptions, footnotes: FootnoteCollector): string {
  switch (node.type) {
    case 'paragraph': {
      // A paragraph colored wall-to-wall belongs to the matching template
      // paragraph style ("Gray Text" text-message beats, …); the style then
      // carries the color and the runs stay clean.
      const uniform = opts.colorStyles ? uniformParagraphColor(node) : null
      const paraStyle = uniform ? nearestColorStyle(uniform, opts.colorStyles!, 'paragraph') : null
      if (paraStyle) {
        return paragraphXml(paraStyle.name, jcOverride(node), serializeInline(node.content, opts, footnotes, uniform))
      }
      return paragraphXml('Body', jcOverride(node), serializeInline(node.content, opts, footnotes))
    }
    case 'heading': {
      // Fiction rarely uses headings; render as bold Body so the manuscript
      // stays typographically quiet.
      const inner = serializeInline(
        node.content?.map(n => n.type === 'text'
          ? { ...n, marks: [...(n.marks ?? []), { type: 'bold' }] }
          : n),
        opts, footnotes,
      )
      return paragraphXml('Body', jcOverride(node), inner)
    }
    case 'horizontalRule': {
      const text = opts.sectionBreakText
        ? `<w:r><w:t xml:space="preserve">${escapeXml(opts.sectionBreakText)}</w:t></w:r>`
        : ''
      return paragraphXml('Section Breaks', null, text)
    }
    case 'blockquote':
      return (node.content ?? [])
        .map(child => serializeBlock(child, opts, footnotes))
        .join('')
        // Indent every paragraph the quote produced.
        .replace(/<w:pPr>/g, '<w:pPr><w:ind w:left="360" w:right="360"/>')
    case 'bulletList':
    case 'orderedList': {
      let idx = 0
      return (node.content ?? []).map(item => {
        idx += 1
        const prefix = node.type === 'bulletList' ? '• ' : `${idx}. `
        const first = item.content?.[0]
        const inner = `<w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>`
          + serializeInline(first?.content, opts, footnotes)
        const rest = (item.content ?? []).slice(1).map(child => serializeBlock(child, opts, footnotes)).join('')
        return paragraphXml('Body', null, inner, '<w:ind w:firstLine="0"/>') + rest
      }).join('')
    }
    case 'codeBlock':
      return paragraphXml('Body', null, serializeInline(node.content, opts, footnotes))
    default:
      // Unknown block — serialize children so no prose is silently lost.
      return (node.content ?? []).map(child => serializeBlock(child, opts, footnotes)).join('')
  }
}

function isEmptyParagraph(node: TipTapNode): boolean {
  if (node.type !== 'paragraph') return false
  return !(node.content ?? []).some(n => (n.type === 'text' && n.text?.trim()) || n.type !== 'text')
}

// Serialize a TipTap doc JSON string to a sequence of <w:p> elements.
// Leading/trailing empty paragraphs are editor residue and get trimmed
// (mirrors stripEmptyParagraphs); interior blanks are the writer's
// deliberate beats and survive.
export function serializeTipTapDoc(json: string, opts: SerializeOptions, footnotes: FootnoteCollector): string {
  let doc: TipTapNode
  try {
    doc = JSON.parse(json)
  } catch {
    // Legacy plain text — one paragraph per line.
    return json.split(/\n+/).filter(l => l.trim()).map(line =>
      paragraphXml('Body', null, textRun(line.trim(), undefined, opts)),
    ).join('')
  }
  let blocks = doc.content ?? []
  let start = 0
  let end = blocks.length
  while (start < end && isEmptyParagraph(blocks[start])) start++
  while (end > start && isEmptyParagraph(blocks[end - 1])) end--
  blocks = blocks.slice(start, end)
  return blocks.map(node => serializeBlock(node, opts, footnotes)).join('')
}
