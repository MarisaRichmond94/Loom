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
export type NarrationChoice = {
  id: string; endingMessage?: string | null; isBadEnding?: boolean
}
export type NarrationBlock = {
  id: string
  type: string
  content?: string | null
  condition?: string | null
  order: number
  overrides?: NarrationOverride[]
  choices?: NarrationChoice[]
}

// One run of spoken prose with no gating choice inside it — the unit we cache
// and synthesize. `blockIds` are the DOM containers (in order) whose words the
// timing was measured against.
export type SegmentSpec = { text: string; blockIds: string[] }

// The narration a reader has unlocked so far, split at each answered choice so
// the shared, branch-independent prefix caches once and answering a choice only
// synthesizes the next segment. `endsAtChoice` is true when the last segment
// stops at a visible, still-unanswered choice (as opposed to the chapter's end
// or a bad ending) — the reader reaches a decision, so the player chimes there.
export type NarrationPlan = { segments: SegmentSpec[]; endsAtChoice: boolean }

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

// Build the narration a reader has unlocked, exactly as they experience it under
// `state` and the choices they've `answered` (choicePointId -> chosen choiceId).
// Walks blocks in order — text and conditional fragments resolved against
// `state` — and splits into segments at each answered choice, because that's
// where a reader unlocks more prose:
//   - An unanswered, visible choice gates the rest of the chapter, so the walk
//     stops there (endsAtChoice = true). A choice whose own condition fails
//     isn't shown — skip it and keep going.
//   - An answered choice closes the current segment (keeping the shared,
//     branch-independent prefix cacheable) and opens the next; the chosen
//     branch's inline consequence prose, if any, begins that next segment,
//     mirroring how the reader renders it at the choice's position.
//   - A bad ending (a matched bad-ending override, or an answered bad-ending
//     choice) truncates the chapter, so the walk stops.
//
// Narration resolves fragments against the reader's current `state` — the same
// state the reader renders against — so a branch's prose matches what's on screen.
export function narrationSegments(
  blocks: NarrationBlock[],
  state: StoryState,
  answered: Record<string, string> = {},
): NarrationPlan {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const segments: SegmentSpec[] = []
  let parts: string[] = []
  let blockIds: string[] = []
  let endsAtChoice = false

  // Close the segment accumulated so far (dropping it if it has no prose).
  const flush = () => {
    if (parts.length) segments.push({ text: parts.join('\n\n'), blockIds })
    parts = []
    blockIds = []
  }

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
        if (matched.endingMessage != null) { flush(); break }
      }
      continue
    }

    if (b.type === 'choice_point') {
      const choiceId = answered[b.id]
      if (choiceId) {
        const chosen = b.choices?.find(c => c.id === choiceId)
        // A bad-ending choice sends the reader to a modal and ends the chapter.
        if (chosen?.isBadEnding) { flush(); break }
        // Close the pre-choice run, then open the next segment with this
        // branch's inline consequence prose (rendered at the choice's position,
        // so its DOM container is the choice-point block id).
        flush()
        if (chosen?.endingMessage) {
          const t = spokenText(chosen.endingMessage, state)
          if (t.trim()) { parts.push(t); blockIds.push(b.id) }
        }
        continue
      }
      // Unanswered: a visible one gates the rest; a hidden one is skipped.
      let visible = true
      if (b.condition) {
        const parsed = safeParse(b.condition)
        if (parsed != null) visible = matchesCondition(parsed as never, state)
      }
      if (visible) { endsAtChoice = true; flush(); break }
      continue
    }
    // soundtrack and any other block types contribute no narration.
  }

  flush()
  return { segments, endsAtChoice }
}

// Fingerprint of what would be spoken. Any prose edit (or a voice change)
// flips this, which is how both triggers detect a stale chapter.
export function narrationHash(text: string, voice: string): string {
  return createHash('sha256').update(voice).update('\0').update(text).digest('hex')
}
