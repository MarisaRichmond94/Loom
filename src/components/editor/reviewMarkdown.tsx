import { Fragment, type ReactNode } from 'react'

/**
 * A deliberately small Markdown renderer for WriteAI review text (KAN-22).
 *
 * Renders to JSX, never to an HTML string. Loom has no Markdown dependency,
 * and the two ways to add one both have costs: a library is a new dependency
 * for one panel, and hand-rolling HTML means injecting model output through
 * dangerouslySetInnerHTML — an XSS surface fed by a language model. Emitting
 * React elements sidesteps both: React escapes text nodes by construction.
 *
 * Covers what the reviews actually use: ATX headings, bold, italic, inline
 * code, bullet and numbered lists, blockquotes, horizontal rules, paragraphs.
 *
 * NOT a general Markdown implementation. No tables, links, nested lists,
 * reference definitions or setext headings. If review output starts leaning on
 * those, reach for `react-markdown` rather than growing this — the point here
 * is a small surface, not a reimplementation.
 */

/** Inline spans: `code`, **bold**, *italic*. Applied in that order so code
 *  spans win — a backtick run containing asterisks stays literal. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-i${i++}`
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-surface-overlay px-1 py-0.5 text-[0.85em] text-accent">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>)
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ReviewMarkdown({ text }: { text: string }) {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  const para: string[] = []
  function flushPara() {
    if (!para.length) return
    const body = para.join(' ')
    blocks.push(
      <p key={`p${key++}`} className="my-2 leading-relaxed">{inline(body, `p${key}`)}</p>,
    )
    para.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { flushPara(); i++; continue }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      const level = heading[1].length
      const size = level === 1 ? 'text-sm' : level === 2 ? 'text-[13px]' : 'text-xs'
      blocks.push(
        <p key={`h${key++}`} className={`${size} font-bold text-ink mt-4 mb-1.5 first:mt-0`}>
          {inline(heading[2], `h${key}`)}
        </p>,
      )
      i++; continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara()
      blocks.push(<hr key={`hr${key++}`} className="my-3 border-accent/15" />)
      i++; continue
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara()
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote key={`q${key++}`} className="my-2 border-l-2 border-accent/40 pl-3 text-ink-muted italic">
          {inline(quoted.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }

    const bullet = /^[-*+]\s+/.test(trimmed)
    const numbered = /^\d+[.)]\s+/.test(trimmed)
    if (bullet || numbered) {
      flushPara()
      const items: string[] = []
      const same = (s: string) => (bullet ? /^[-*+]\s+/ : /^\d+[.)]\s+/).test(s.trim())
      while (i < lines.length && lines[i].trim() && same(lines[i])) {
        items.push(lines[i].trim().replace(bullet ? /^[-*+]\s+/ : /^\d+[.)]\s+/, ''))
        i++
      }
      const Tag = bullet ? 'ul' : 'ol'
      blocks.push(
        <Tag key={`l${key++}`} className={`my-2 pl-5 space-y-1 ${bullet ? 'list-disc' : 'list-decimal'}`}>
          {items.map((it, n) => (
            <li key={n} className="leading-relaxed">{inline(it, `l${key}-${n}`)}</li>
          ))}
        </Tag>,
      )
      continue
    }

    para.push(trimmed)
    i++
  }
  flushPara()

  return <Fragment>{blocks}</Fragment>
}
