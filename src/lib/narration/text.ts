import { createHash } from 'crypto'
import { extractTextFromTipTap } from '@/lib/tiptapText'
import { substituteVarTemplates } from '@/lib/templateVars'
import { resolveConditionalOverride, matchesCondition, type StoryState } from '@/lib/storyEngine'

// One spoken word with the character range it occupies in the narration text
// and its start offset in the audio — emitted verbatim by the Swift helper's
// willSpeakRange callbacks. `word` is persisted so the reader can resync the
// highlight by exact token match if the DOM token sequence ever drifts.
export type WordTiming = { charStart: number; charLen: number; timeMs: number; word: string }

export type NarrationOverride = {
  id: string; order: number; condition: string; content: string; endingMessage?: string | null
}
export type NarrationBlock = {
  id: string
  type: string
  content?: string | null
  condition?: string | null
  order: number
  overrides?: NarrationOverride[]
}

// The macOS system voice used for narration. Matches ~/Scripts/generate_audiobook.sh.
export const DEFAULT_VOICE = 'Tom (Enhanced)'

function safeParse(json: string): unknown {
  try { return JSON.parse(json) } catch { return null }
}

// Extract a block's spoken text the way the reader renders it: plain text with
// {{var}} / {{cond ? a : b}} templates substituted against `state`. Without
// this the audio would speak raw template syntax AND — because the reader shows
// the substituted words — the token counts would diverge from that point on,
// drifting the highlight further with every template. Identity escape (not
// escapeHtml) because this is plain narration text, not HTML.
function spokenText(json: string | null | undefined, state: StoryState): string {
  const t = extractTextFromTipTap(json)
  return t ? substituteVarTemplates(t, state, s => s) : t
}

// Build the narration for a chapter as a fresh reader would experience it under
// `state`: text blocks and each conditional fragment resolved against that
// state, in order, stopping where the reader stops — at a bad-ending override
// (its prose IS the ending) or the first visible, unanswered choice point
// (everything after is gated). Returns the spoken text plus the ordered ids of
// the blocks that contributed, so the reader can word-wrap exactly those
// containers in the same sequence the audio was timed against.
//
// v1 narrates against the default variable state (what the Preview button
// shows on a fresh session). If the reader later flips variables via Configure,
// a fragment may resolve to different prose than was narrated.
export function narrationContent(blocks: NarrationBlock[], state: StoryState): { text: string; blockIds: string[] } {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const parts: string[] = []
  const blockIds: string[] = []

  for (const b of ordered) {
    if (b.type === 'text') {
      const t = spokenText(b.content, state)
      if (t.trim()) { parts.push(t); blockIds.push(b.id) }
      continue
    }

    if (b.type === 'conditional_fragment') {
      const overrides = (b.overrides ?? [])
        .map(o => {
          const cond = safeParse(o.condition)
          return cond == null ? null : { id: o.id, order: o.order, condition: cond as never, content: o.content, endingMessage: o.endingMessage ?? null }
        })
        .filter((o): o is NonNullable<typeof o> => o !== null)
      const matched = resolveConditionalOverride({ overrides }, state)
      if (matched) {
        const t = spokenText(matched.content, state)
        if (t.trim()) { parts.push(t); blockIds.push(b.id) }
        // A matched bad-ending override truncates the chapter for the reader.
        if (matched.endingMessage != null) break
      }
      continue
    }

    if (b.type === 'choice_point') {
      // On a fresh read every choice is unanswered; a visible one gates the
      // rest of the chapter, so narration ends there too. A choice whose own
      // condition fails isn't shown — skip it and keep going.
      let visible = true
      if (b.condition) {
        const parsed = safeParse(b.condition)
        if (parsed != null) visible = matchesCondition(parsed as never, state)
      }
      if (visible) break
      continue
    }
    // soundtrack and any other block types contribute no narration.
  }

  return { text: parts.join('\n\n'), blockIds }
}

// Fingerprint of what would be spoken. Any prose edit (or a voice change)
// flips this, which is how both triggers detect a stale chapter.
export function narrationHash(text: string, voice: string): string {
  return createHash('sha256').update(voice).update('\0').update(text).digest('hex')
}
