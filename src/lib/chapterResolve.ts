// Resolve a chapter's blocks against a StoryState — the single source of
// truth shared by the Copy button (which needs the resolved prose) and the
// write-mode path lens (which needs to know which block/override/branch is
// active so it can dim the rest). Keeping both on this one walk guarantees
// "what you copy == what the lens highlights == what Preview renders" for a
// given context, rather than three subtly different resolutions drifting apart.

import {
  matchesCondition,
  resolveConditionalOverride,
  type StoryState,
  type Condition,
  type ChoiceSetValue,
} from './storyEngine'

// The loose block shape both callers already have on hand (the chapter page's
// currentBlocksRef and BlockEditor's local block list). Overrides carry their
// condition as a JSON string on disk; choices carry setsVariables the same way.
export type ResolveChoice = {
  id: string
  order: number
  setsVariables: string
  condition?: string | null
  endingMessage?: string | null
  isBadEnding?: boolean
  endsChapter?: boolean
}
export type ResolveOverride = {
  id: string
  order: number
  condition: string
  content: string
  endingMessage?: string | null
  endsChapter?: boolean
}
export type ResolveBlock = {
  id: string
  type: string
  content?: string | null
  condition?: string | null
  choices?: ResolveChoice[]
  overrides?: ResolveOverride[]
}

export type BlockResolution = {
  // Whether this block contributes to the resolved read-through under the
  // current state. False when a gate fails, no override matches, or an
  // earlier block already ended the chapter.
  included: boolean
  // The prose JSON that actually renders (text content, matched override
  // content, or canon branch text). Null when the block renders nothing.
  source: string | null
  // For a conditional fragment: the id of the override that matched (null if
  // none). Lets the lens highlight it and dim the siblings.
  activeOverrideId: string | null
  // For a choice point: the id of the branch on the resolved path (null if
  // the block is gated out). Lets the lens highlight it and dim the siblings.
  activeChoiceId: string | null
}

function safeCondition(raw: string | null | undefined): Condition | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Condition) : null
  } catch {
    return null
  }
}

function parseChoiceSets(raw: string): Record<string, ChoiceSetValue> {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// A choice contradicts the canon (default) state when it directly assigns a
// variable a value different from its current value. `+=` / `-=` accumulations
// can't be compared against a single value, so they never contradict — number
// targets are handled separately (rule b) anyway.
function choiceContradicts(sets: Record<string, ChoiceSetValue>, target: StoryState): boolean {
  return Object.entries(sets).some(([name, instruction]) => {
    if (!(name in target)) return false
    const assigned =
      typeof instruction === 'object' && instruction !== null
        ? instruction.op === '=' ? instruction.value : null
        : instruction
    return assigned !== null && assigned !== target[name]
  })
}

// Pick a choice point's branch for the resolved read-through under `state`:
//   (a) boolean/string-only points collapse to the option whose assignments
//       AGREE with the state (the branch that establishes the state's value);
//   (b) any number-typed target is ambiguous (accumulators have no obvious
//       state-matching branch) → fall back to the first option.
// Bad-ending branches are never on the canon path; gated extras (order >= 2)
// only count when their own condition holds for the state. This is the same
// heuristic Copy has always used, lifted here so the lens shares it.
export function resolveCanonChoice(
  choices: ResolveChoice[],
  state: StoryState,
  varType: Record<string, string>,
): ResolveChoice | null {
  const candidates = choices
    .filter(c => !c.isBadEnding)
    .filter(c => {
      if (c.order < 2) return true // base pair always shows, ignores its gate
      const gate = safeCondition(c.condition)
      return !gate || matchesCondition(gate, state)
    })
    .sort((a, b) => a.order - b.order)
  if (candidates.length === 0) return null

  const setNames = new Set(candidates.flatMap(c => Object.keys(parseChoiceSets(c.setsVariables))))
  if ([...setNames].some(n => varType[n] === 'number')) return candidates[0]

  const consistent = candidates.filter(c => !choiceContradicts(parseChoiceSets(c.setsVariables), state))
  if (consistent.length === 1) return consistent[0]
  const setter = consistent.find(c => Object.keys(parseChoiceSets(c.setsVariables)).length > 0)
  return setter ?? consistent[0] ?? candidates[0]
}

// Seed a StoryState from the series' variable defaults, then overlay whatever
// the path lens has configured. A missing lens leaves the pure-default (canon)
// state — exactly what Copy produced before the lens existed.
export function buildStoryState(
  variables: Array<{ name: string; type: string; defaultValue?: string }>,
  lensState?: StoryState | null,
): StoryState {
  const state: StoryState = {}
  for (const v of variables) {
    if (v.type === 'boolean') state[v.name] = String(v.defaultValue).toLowerCase() === 'true'
    else if (v.type === 'number') state[v.name] = Number(v.defaultValue ?? 0)
    else state[v.name] = v.defaultValue ?? ''
  }
  return lensState ? { ...state, ...lensState } : state
}

export function varTypeMap(variables: Array<{ name: string; type: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of variables) out[v.name] = v.type
  return out
}

// Walk every block in order, resolving each against `storyState`. Once a
// matched override or chosen branch flags endsChapter, every later block is
// marked not-included (the chapter is over) — mirroring the reader's
// truncation and giving the lens a reason to dim the tail.
export function resolveChapter(
  blocks: ResolveBlock[],
  storyState: StoryState,
  varType: Record<string, string>,
): Map<string, BlockResolution> {
  const out = new Map<string, BlockResolution>()
  let ended = false
  for (const block of blocks) {
    if (ended) {
      out.set(block.id, { included: false, source: null, activeOverrideId: null, activeChoiceId: null })
      continue
    }
    if (block.type === 'text') {
      const gate = safeCondition(block.condition)
      const included = !gate || matchesCondition(gate, storyState)
      out.set(block.id, { included, source: included ? block.content ?? null : null, activeOverrideId: null, activeChoiceId: null })
    } else if (block.type === 'conditional_fragment') {
      const matched = resolveConditionalOverride(
        {
          overrides: (block.overrides ?? []).map(o => ({
            id: o.id,
            order: o.order,
            condition: safeCondition(o.condition) ?? {},
            content: o.content,
            endingMessage: null,
            endsChapter: o.endsChapter ?? false,
          })),
        },
        storyState,
      )
      out.set(block.id, {
        included: !!matched,
        source: matched?.content ?? null,
        activeOverrideId: matched?.id ?? null,
        activeChoiceId: null,
      })
      if (matched?.endsChapter) ended = true
    } else if (block.type === 'choice_point') {
      const gate = safeCondition(block.condition)
      if (gate && !matchesCondition(gate, storyState)) {
        out.set(block.id, { included: false, source: null, activeOverrideId: null, activeChoiceId: null })
        continue
      }
      const canon = resolveCanonChoice(block.choices ?? [], storyState, varType)
      out.set(block.id, {
        included: !!canon,
        source: canon?.endingMessage ?? null,
        activeOverrideId: null,
        activeChoiceId: canon?.id ?? null,
      })
      if (canon?.endsChapter) ended = true
    } else {
      // Soundtrack and any future non-prose block: always present, no lens effect.
      out.set(block.id, { included: true, source: null, activeOverrideId: null, activeChoiceId: null })
    }
  }
  return out
}
