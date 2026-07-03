import {
  applyChoice,
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

export type ManuscriptChapter = {
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
  choices: Array<{
    id: string
    label: string
    setsVariables: string
    targetChapterId: string | null
    endingMessage: string | null
    isBadEnding: boolean
  }>
  overrides: Array<{
    id: string
    order: number
    condition: string
    content: string
    endingMessage: string | null
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
      label,
      numbered,
      pov: chapter.pov,
      date: chapter.date,
      contents: [],
      stateByContent: [],
    }

    let jumpToChapterId: string | null = null
    let endWalk = false

    for (const block of [...chapter.blocks].sort((a, b) => a.order - b.order)) {
      if (block.type === 'text') {
        if (block.content) {
          out.contents.push(block.content)
          out.stateByContent.push({ ...state })
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
          out.contents.push(matched.content)
          out.stateByContent.push({ ...state })
        }
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
          out.contents.push(resolved.endingMessage)
          out.stateByContent.push({ ...state })
        }
        endWalk = true
        break
      }
      // Inline branch text renders at the choice point's position.
      if (resolved.endingMessage) {
        out.contents.push(resolved.endingMessage)
        out.stateByContent.push({ ...state })
      }
      if (resolved.targetChapterId) {
        // The reader is carried straight to the target chapter; anything
        // after the choice point in this chapter is never shown.
        jumpToChapterId = resolved.targetChapterId
        break
      }
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
