import { generateHTML } from '@tiptap/html/server'
import { PROSE_EXTENSIONS, escapeHtml } from '@/lib/renderRichContent'
import { stripEmptyParagraphs } from '@/lib/clipboardFormatting'
import { substituteVarTemplates } from '@/lib/templateVars'
import type { StoryState } from '@/lib/storyEngine'

/**
 * TipTap JSON -> HTML, on the server, for publish (LOOM-131).
 *
 * `@tiptap/html`'s default entry point refuses to run outside a browser
 * ("generateHTML can only be used in a browser environment"). `/server` is the
 * Node build. The extension list is imported rather than repeated, so the two
 * renderers cannot drift.
 *
 * IT THROWS. renderRichContent swallows failures and returns '' — sensible in a
 * component, where a blank paragraph beats a crashed page. In publish that same
 * behaviour silently produced a snapshot of EMPTY CHAPTERS, which is exactly
 * the kind of failure that looks like success. A publish that cannot render
 * prose must stop.
 */
export function renderProseHtml(json: string | null | undefined, state: StoryState): string {
  if (!json) return ''
  let html: string
  try {
    html = generateHTML(JSON.parse(json), PROSE_EXTENSIONS)
  } catch (e) {
    throw new Error(
      `Could not render prose to HTML: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  // Templates are resolved HERE, against the state at this point in the walk,
  // so the reader receives prose with nothing left to compute.
  return substituteVarTemplates(stripEmptyParagraphs(html), state, escapeHtml)
}
