// Shared TipTap → HTML renderer for content that the writer authored in a
// rich-text editor (text blocks, conditional override content, per-choice
// branch text). Pulled out of ReaderView so any reader-side surface that
// needs to render the same JSON shape can do so without duplicating the
// extension list.

import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { ParagraphIndent } from '@/lib/extensions/paragraphIndent'
import { stripEmptyParagraphs } from '@/lib/clipboardFormatting'
import { substituteVarTemplates } from '@/lib/templateVars'
import type { StoryState } from '@/lib/storyEngine'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Generates HTML from a TipTap doc JSON string. When `storyState` is
// provided, substitutes {{var}} / {{var ? a : b}} templates against it.
// Returns the empty string on parse failure.
export function renderTipTapJson(json: string | null | undefined, storyState?: StoryState): string {
  if (!json) return ''
  try {
    const html = generateHTML(JSON.parse(json), [StarterKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), ParagraphIndent, TextStyle, Color, Footnote, CharacterMark])
    const stripped = stripEmptyParagraphs(html)
    if (!storyState) return stripped
    return substituteVarTemplates(stripped, storyState, escapeHtml)
  } catch {
    return ''
  }
}

// Per-choice branch text and conditional-override endingMessage columns
// have two on-disk shapes: legacy plain text (old data) and TipTap JSON
// (new). This helper returns rendered HTML for the JSON case, or null
// for the caller to fall back to a plain-text wrapper.
export function tryRenderRichContent(content: string | null | undefined, storyState?: StoryState): string | null {
  if (!content) return null
  // TipTap docs always serialize as a JSON object starting with `{`.
  // Anything else is legacy plain text written before this feature — return
  // null so the caller wraps it in a paragraph verbatim.
  if (!content.trimStart().startsWith('{')) return null
  // From here the content IS rich JSON, so always return a string: the
  // rendered HTML, or '' when the doc has no visible content (e.g. an empty
  // placeholder paragraph). Never null here — a null would make the caller
  // mistake empty rich content for legacy plain text and print the raw JSON.
  // '' tells the caller to render nothing.
  try {
    return renderTipTapJson(content, storyState)
  } catch {
    return ''
  }
}
