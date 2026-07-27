'use client'

import { useMemo } from 'react'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Mark, mergeAttributes, type JSONContent } from '@tiptap/core'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { ParagraphIndent } from '@/lib/extensions/paragraphIndent'

// Read-only twin of the custom colour mark used in TextBlock — mirrored here
// so a pinned snapshot renders inline colour exactly as the live editor does
// (without pulling in TextBlock's whole editing machinery).
const TextStyleColor = Mark.create({
  name: 'textStyle',
  priority: 101,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: element => (element as HTMLElement).style?.color?.replace(/['"]+/g, '') || null,
        renderHTML: attributes => (attributes.color ? { style: `color: ${attributes.color}` } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span', consuming: false, getAttrs: element => ((element as HTMLElement).style?.color ? {} : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

// Schema-only extension set — enough to faithfully render stored prose JSON
// to HTML (marks, alignment, indent, character/footnote tags). The decoration
// plugins (search/variable highlight) don't affect the schema, so they're
// omitted; `{{var}}` tokens simply render as their literal text.
const REFERENCE_EXTENSIONS = [
  StarterKit,
  TextAlign.configure({ types: ['paragraph', 'heading'] }),
  ParagraphIndent,
  Footnote,
  CharacterMark,
  TextStyleColor,
]

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

function toDoc(raw: string | null | undefined): JSONContent {
  if (!raw) return EMPTY_DOC
  try {
    return JSON.parse(raw)
  } catch {
    // Legacy plain-string rows: one paragraph per line.
    const paragraphs = raw.split(/\n+/).map(line => {
      const t = line.trim()
      return t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' }
    })
    return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
  }
}

// Frozen prose rendered from stored TipTap JSON. Matches the editor's prose
// styling (justify, first-line indent, section-break rule, character tags)
// but is inert — no toolbar, no editing, no plugins.
function RefProse({ content }: { content: string | null | undefined }) {
  const html = useMemo(() => {
    try {
      return generateHTML(toDoc(content), REFERENCE_EXTENSIONS)
    } catch {
      return ''
    }
  }, [content])
  return (
    <div
      // Font size tracks the body prose zoom (⌥⇧+ / ⌥⇧-) via the same
      // --loom-prose-scale var set on <html>, so both scale together.
      style={{ fontSize: 'calc(var(--loom-prose-scale, 1) * 1rem)' }}
      className="prose prose-invert max-w-none text-ink text-base leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_p.no-indent]:indent-0 [&_p[style*='center']]:indent-0 [&_p]:my-0 [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-accent/20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-4 [&_.character-ref]:text-accent/80 [&_.character-ref]:underline [&_.character-ref]:decoration-dotted [&_.character-ref]:decoration-accent/40"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// A pinned snapshot of a single prose unit — a text block, a conditional
// override, or a choice branch. Just the TipTap JSON, frozen at pin time.
export type PinnedText = {
  pinId: string
  content: string
}

// The stack of pinned snapshots. Content only — the panel frame (width, drag
// handle, tab strip, close) belongs to SidePanel, which this shares with the
// chapter notes tab.
export function ReferenceList({ pins }: { pins: PinnedText[] }) {
  return (
    <div className="flex-1 p-4 space-y-4">
      {pins.map(pin => (
        <div key={pin.pinId} className="border-b border-accent/10 pb-4 last:border-0 last:pb-0">
          <RefProse content={pin.content} />
        </div>
      ))}
    </div>
  )
}
