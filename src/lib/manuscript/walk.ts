import {
  applyChoice,
  matchesCondition,
  resolveConditionalOverride,
  type ChoiceRecord,
  type ChoiceSetValue,
  type StoryState,
} from '@/lib/storyEngine'
import { isChapterVisible } from '@/lib/chapterLabels'

// Flattens one book into a linear manuscript by simulating a read-through:
// chapters in order, conditionals resolved against the evolving story state,
// each choice point collapsed to the branch consistent with the writer's
// target context. Pure — callers load the book via Prisma and pass it in.

export type WalkChoice = {
  id: string
  label: string
  isBadEnding: boolean
}

export type WalkChoicePoint = {
  choicePointId: string
  chapterLabel: string
  prompt: string | null
  choices: WalkChoice[]
  // The branch the walk took: an explicit override when given, otherwise
  // the unique choice that doesn't contradict the target context.
  resolvedChoiceId: string | null
  // True when auto-resolution couldn't single out a branch and no override
  // was supplied — the export modal must ask the writer.
  ambiguous: boolean
}

/**
 * One renderable unit on the canon path, with its identity intact.
 *
 * `contents` below is a `string[]`, which is all the manuscript export needs —
 * it concatenates prose into a document. A reading surface needs more: stable
 * ids to anchor comments and reading positions to, and the non-prose blocks a
 * document cannot represent. Emitting both from ONE walk is deliberate; a
 * second walk that computed the canon path separately would be a second thing
 * to drift.
 */
export type WalkedBlock = {
  /**
   * Stable across republishes, which is the whole point — reader positions and
   * comment anchors hang off these.
   *
   * Real blocks use their own id. Content that is not a block in its own right
   * gets a deterministic composite of ids that are themselves stable:
   *   - a taken branch's inline text -> `<choicePointId>:choice:<choiceId>`
   *   - a matched conditional override -> `<fragmentBlockId>:override:<id>`
   * Never generated, never positional.
   */
  id: string
  /** `text` or `soundtrack`. Resolved conditionals arrive already flattened to text. */
  type: string
  /** TipTap doc JSON for text; the media path for soundtrack. */
  content: string
  displayType: string | null
  /** The ContentBlock this came from, for tracing back into Loom. */
  sourceBlockId: string
}

export type ManuscriptChapter = {
  id: string
  // "1", "2", … for numbered chapters; the authored title otherwise.
  label: string
  numbered: boolean
  pov: string | null
  date: string | null
  // TipTap doc JSON strings in reading order (text blocks, resolved
  // conditional content, inline branch text).
  contents: string[]
  // Story state as of the top of this chapter — conditional fragments and
  // template substitution inside the chapter see mid-chapter updates via
  // the walk, so each content entry carries its own state snapshot.
  stateByContent: StoryState[]
  /**
   * The same path as `contents`, plus the blocks a manuscript cannot carry.
   *
   * NOT a parallel array to `contents` — `soundtrack` blocks appear here and
   * deliberately never there. Putting a media path into `contents` would write
   * it into the exported .docx/.pages.
   */
  blocks: WalkedBlock[]
  /**
   * Story state as the walk ENTERS this chapter, before any of its blocks run.
   *
   * `stateByContent` only has entries where content was emitted, so a chapter
   * that emits nothing has no state at all — and narration needs the entry
   * state regardless, to resolve the same conditions the reader would.
   */
  stateAtStart: StoryState
  /**
   * Choice points resolved inside this chapter: choicePointId -> chosen id.
   *
   * This is what makes canon narration findable. `ChapterNarration` is keyed by
   * a hash of the segment texts, and the segments depend on which choices were
   * answered — so reproducing the canon variant hash needs the canon answers,
   * per chapter, in the walk's own resolution order.
   */
  answeredChoices: Record<string, string>
}

export type WalkResult = {
  chapters: ManuscriptChapter[]
  choicePoints: WalkChoicePoint[]
  warnings: string[]
}

type BlockIn = {
  id: string
  order: number
  type: string
  content: string | null
  prompt: string | null
  /** Presentation hint the reader needs; irrelevant to the manuscript export. */
  displayType?: string | null
  /**
   * Per-block gate, evaluated against the evolving story state.
   *
   * The writer uses this to make a choice point mutually exclusive with an
   * earlier one — "Does Noah pull the trigger?" is gated on
   * `didJaredKillHisGrandpa: false`, so exactly one of them can fire. The
   * reader has always honoured it; this walk did not, because the field was
   * dropped in loadManuscriptBook and absent from this type.
   */
  condition?: string | null
  choices: Array<{
    id: string
    label: string
    setsVariables: string
    targetChapterId: string | null
    endingMessage: string | null
    isBadEnding: boolean
    endsChapter: boolean
  }>
  overrides: Array<{
    id: string
    order: number
    condition: string
    content: string
    endingMessage: string | null
    endsChapter: boolean
  }>
}

export type ChapterInWalk = {
  id: string
  title: string
  order: number
  pov: string | null
  date: string | null
  condition: string | null
  numbered: boolean
  blocks: BlockIn[]
}

export type VariableIn = { name: string; type: string; defaultValue: string }

export function defaultStoryState(variables: VariableIn[]): StoryState {
  const state: StoryState = {}
  for (const v of variables) {
    try {
      const parsed = JSON.parse(v.defaultValue)
      if (parsed !== null) state[v.name] = parsed
    } catch { /* unparseable default — leave unset */ }
  }
  return state
}

function parseSets(raw: string): Record<string, ChoiceSetValue> {
  try { return JSON.parse(raw) } catch { return {} }
}

// A choice contradicts the target context when it directly assigns a
// variable a value different from the one the writer asked for. `+=`/`-=`
// accumulations can't be compared to a target value, so they never
// contradict — points relying on them surface as ambiguous instead.
function contradictsTarget(sets: Record<string, ChoiceSetValue>, target: StoryState): boolean {
  return Object.entries(sets).some(([name, instruction]) => {
    if (!(name in target)) return false
    const assigned = typeof instruction === 'object' && instruction !== null
      ? (instruction.op === '=' ? instruction.value : null)
      : instruction
    return assigned !== null && assigned !== target[name]
  })
}

export function walkBook(
  chapters: ChapterInWalk[],
  variables: VariableIn[],
  targetState: StoryState,
  choiceOverrides: Record<string, string>,
): WalkResult {
  const ordered = [...chapters].sort((a, b) => a.order - b.order)
  const indexById = new Map(ordered.map((c, i) => [c.id, i]))

  let state = defaultStoryState(variables)
  const result: WalkResult = { chapters: [], choicePoints: [], warnings: [] }

  let counter = 0
  let i = 0
  let steps = 0
  // Backward jumps could loop forever; four visits per chapter is far past
  // any legitimate structure.
  const maxSteps = Math.max(ordered.length * 4, 64)

  while (i < ordered.length) {
    if (++steps > maxSteps) {
      result.warnings.push('Stopped: the chosen path revisits chapters in a loop.')
      break
    }
    const chapter = ordered[i]
    if (!isChapterVisible(chapter, state)) { i += 1; continue }

    const numbered = chapter.numbered !== false
    const label = numbered ? String(++counter) : chapter.title
    const out: ManuscriptChapter = {
      id: chapter.id,
      label,
      numbered,
      pov: chapter.pov,
      date: chapter.date,
      contents: [],
      stateByContent: [],
      blocks: [],
      stateAtStart: { ...state },
      answeredChoices: {},
    }

    // Every push into `contents` records the block it came from in the same
    // step. One helper rather than two call sites per emission, so the
    // manuscript path and the reader path cannot drift apart.
    const emitText = (content: string, id: string, sourceBlockId: string, displayType: string | null = null) => {
      out.contents.push(content)
      out.stateByContent.push({ ...state })
      out.blocks.push({ id, type: 'text', content, displayType, sourceBlockId })
    }

    let jumpToChapterId: string | null = null
    let endWalk = false

    for (const block of [...chapter.blocks].sort((a, b) => a.order - b.order)) {
      // Block-level gate, checked against state as of THIS point in the walk —
      // not the chapter's opening state. A choice point gated on a variable an
      // earlier choice point in the same chapter sets (Nobody's Hero 24 does
      // exactly this) only resolves correctly if the two are evaluated in
      // order.
      if (!isBlockVisible(block.condition, state)) continue
      if (block.type === 'text') {
        if (block.content) emitText(block.content, block.id, block.id, block.displayType ?? null)
        continue
      }
      if (block.type === 'soundtrack') {
        // Reader-only, and deliberately NOT pushed into `contents`: that array
        // becomes the exported .docx/.pages, and a media path is not prose.
        if (block.content) {
          out.blocks.push({
            id: block.id,
            type: 'soundtrack',
            content: block.content,
            displayType: block.displayType ?? null,
            sourceBlockId: block.id,
          })
        }
        continue
      }
      if (block.type === 'conditional_fragment') {
        const matched = resolveConditionalOverride({
          overrides: block.overrides.map(o => ({
            id: o.id,
            order: o.order,
            condition: safeParseCondition(o.condition),
            content: o.content,
            endingMessage: o.endingMessage,
            endsChapter: o.endsChapter,
          })),
        }, state)
        if (!matched) continue
        if (matched.endingMessage) {
          result.warnings.push(
            `A conditional in Chapter ${label} triggers an ending ("${plainSnippet(matched.endingMessage)}") under this context — it was skipped.`,
          )
          continue
        }
        if (matched.content) {
          // Anchored on the fragment block plus the override, both stable ids.
          // The reader receives this already resolved to text — no condition
          // evaluation happens on the reader tier.
          emitText(matched.content, `${block.id}:override:${matched.id}`, block.id)
        }
        // A matched "ends chapter" override cleanly closes the chapter here:
        // its content is the last thing shown and the walk resumes at the next
        // chapter in book order. Distinct from a bad ending, which is skipped
        // in canon (above) — this IS the canon end of the chapter.
        if (matched.endsChapter) break
        continue
      }
      if (block.type !== 'choice_point') continue

      const overrideId = choiceOverrides[block.id]
      const candidates = block.choices.filter(c => !c.isBadEnding)
      const nonContradicting = candidates.filter(c => !contradictsTarget(parseSets(c.setsVariables), targetState))

      let resolved = overrideId
        ? block.choices.find(c => c.id === overrideId) ?? null
        : null
      let ambiguous = false
      if (!resolved) {
        if (nonContradicting.length === 1) {
          resolved = nonContradicting[0]
        } else {
          ambiguous = true
          // Keep walking so downstream choice points still surface in the
          // plan; the export itself refuses while any point is ambiguous.
          resolved = nonContradicting[0] ?? candidates[0] ?? block.choices[0] ?? null
        }
      }

      result.choicePoints.push({
        choicePointId: block.id,
        chapterLabel: numbered ? `Chapter ${label}` : label,
        prompt: block.prompt,
        choices: block.choices.map(c => ({ id: c.id, label: c.label, isBadEnding: c.isBadEnding })),
        resolvedChoiceId: resolved?.id ?? null,
        ambiguous,
      })
      if (!resolved) continue
      out.answeredChoices[block.id] = resolved.id

      const record: ChoiceRecord = {
        id: resolved.id,
        setsVariables: parseSets(resolved.setsVariables),
        targetChapterId: resolved.targetChapterId,
      }
      state = applyChoice(state, [], block.id, record).newState

      if (resolved.isBadEnding) {
        result.warnings.push(
          `Chapter ${label}: the selected branch "${resolved.label}" is a bad ending — the manuscript stops there.`,
        )
        if (resolved.endingMessage) {
          emitText(resolved.endingMessage, `${block.id}:choice:${resolved.id}`, block.id)
        }
        endWalk = true
        break
      }
      // Inline branch text renders at the choice point's position.
      if (resolved.endingMessage) {
        emitText(resolved.endingMessage, `${block.id}:choice:${resolved.id}`, block.id)
      }
      if (resolved.targetChapterId) {
        // The reader is carried straight to the target chapter; anything
        // after the choice point in this chapter is never shown.
        jumpToChapterId = resolved.targetChapterId
        break
      }
      // A no-target "ends chapter" branch closes the chapter here; the walk
      // resumes at the next chapter in book order (the reader gets there via
      // the footer). A targeted branch already jumped above.
      if (resolved.endsChapter) break
    }

    result.chapters.push(out)
    if (endWalk) break

    if (jumpToChapterId) {
      const target = indexById.get(jumpToChapterId)
      if (target === undefined) {
        result.warnings.push(`Chapter ${label}: a choice jumps to a chapter outside this book — stopped there.`)
        break
      }
      i = target
    } else {
      i += 1
    }
  }

  return result
}

function safeParseCondition(raw: string): Record<string, boolean | number | string> {
  try { return JSON.parse(raw) } catch { return {} }
}

/**
 * Whether a block fires under the current story state.
 *
 * Mirrors `isChapterVisible` deliberately, including failing OPEN on an absent
 * or unparseable condition: prose that cannot be evaluated should still reach
 * the manuscript, because silently dropping a paragraph is worse than showing
 * one that should have been gated.
 *
 * Goes through `matchesCondition` rather than a plain equality check because
 * block conditions can be compound — The Secrets We Keep chapter 10 gates a
 * choice point on an `{op:'or', clauses:[…]}`, which a naive comparison would
 * silently evaluate as false and drop.
 */
function isBlockVisible(condition: string | null | undefined, state: StoryState): boolean {
  if (!condition) return true
  try {
    return matchesCondition(JSON.parse(condition), state)
  } catch {
    return true
  }
}

// Endings are stored as TipTap JSON or legacy plain text; pull a short
// plain-text snippet for warning messages.
function plainSnippet(raw: string): string {
  let text = raw
  if (raw.trimStart().startsWith('{')) {
    try {
      const collect = (node: { text?: string; content?: unknown[] }): string =>
        (node.text ?? '') + (Array.isArray(node.content) ? node.content.map(c => collect(c as { text?: string })).join('') : '')
      text = collect(JSON.parse(raw))
    } catch { /* fall through with raw */ }
  }
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}
