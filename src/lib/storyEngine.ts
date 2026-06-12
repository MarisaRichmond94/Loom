export type StoryState = Record<string, boolean | number | string>

export type HistoryEntry = {
  choicePointId: string
  choiceId: string
  stateSnapshot: StoryState
}

// Conditions can be stored in two shapes that the engine reads transparently:
//   1. Legacy: `{ varA: 1, varB: 2 }` — implicit AND of equalities. Continues to be
//      the on-disk format for single-variable or all-AND conditions (no migration).
//   2. Compound: `{ op: 'and' | 'or', clauses: [{ var, value }, ...] }` — explicit
//      operator. The editor only writes this when the writer picks "any of" (OR).
export type ConditionLeafValue = boolean | number | string
export type LegacyCondition = Record<string, ConditionLeafValue>
export type CompoundCondition = {
  op: 'and' | 'or'
  clauses: Array<{ var: string; value: ConditionLeafValue }>
  // When 'hide', the condition flips polarity: a matching clause set means
  // "hide this chapter" rather than the default "show this chapter". Stored
  // here (not on a sibling column) so the existing condition JSON is the
  // single source of truth across the engine, reader, and editor.
  mode?: 'hide'
}
export type Condition = LegacyCondition | CompoundCondition

function isCompoundCondition(c: unknown): c is CompoundCondition {
  return (
    typeof c === 'object' &&
    c !== null &&
    'op' in c &&
    'clauses' in c &&
    Array.isArray((c as CompoundCondition).clauses)
  )
}

export type ConditionalOverrideEntry = {
  id: string
  order: number
  condition: Condition
  content: string
  // When set, the matched override fires a Bad Ending modal instead of
  // rendering content inline. The reader uses this to detect ending triggers
  // from the alignment of several variables.
  endingMessage?: string | null
}

export type ConditionalBlock = {
  overrides: ConditionalOverrideEntry[]
}

// What a choice can write to a variable when chosen. Two shapes:
//   - Primitive value: "set this variable to N" (the legacy on-disk form).
//   - { op, value } object: "add to / subtract from / set to N" — used
//     by counter-style variables (e.g. jaredLieCount += 1) so a choice
//     can accumulate rather than overwrite. Op '=' is identical to the
//     primitive form; '+=' / '-=' only make sense for number variables.
export type ChoiceSetOp = '=' | '+=' | '-='
export type ChoiceSetValue =
  | boolean | number | string
  | { op: ChoiceSetOp; value: number }

export type ChoiceRecord = {
  id: string
  setsVariables: Record<string, ChoiceSetValue>
  targetChapterId: string | null
}

// Resolve one variable's new value given the choice's instruction and the
// current state. Primitive instructions overwrite; object instructions
// fold the op against the variable's current numeric value (defaulting
// to 0 when the variable hasn't been set yet — matches how counter
// initialization usually feels to the reader).
function applyVarOp(current: StoryState[string] | undefined, instruction: ChoiceSetValue): boolean | number | string {
  if (typeof instruction !== 'object' || instruction === null) return instruction
  const base = typeof current === 'number' ? current : Number(current ?? 0)
  const n = Number.isFinite(base) ? base : 0
  if (instruction.op === '+=') return n + instruction.value
  if (instruction.op === '-=') return n - instruction.value
  return instruction.value
}

export function matchesCondition(condition: Condition, storyState: StoryState): boolean {
  if (isCompoundCondition(condition)) {
    const test = (cl: { var: string; value: ConditionLeafValue }) => storyState[cl.var] === cl.value
    const matched = condition.op === 'or' ? condition.clauses.some(test) : condition.clauses.every(test)
    // mode='hide' inverts: the chapter is "visible" when the clauses DON'T match.
    // Block overrides never set this mode, so override resolution is unaffected.
    return condition.mode === 'hide' ? !matched : matched
  }
  return Object.entries(condition).every(([k, v]) => storyState[k] === v)
}

export function resolveConditional(block: ConditionalBlock, storyState: StoryState): string | null {
  const matched = resolveConditionalOverride(block, storyState)
  return matched?.content ?? null
}

// Returns the full matched override (or null) so callers that need fields
// beyond the rendered content (e.g. endingMessage for Bad Ending triggers)
// can use them without a second pass.
export function resolveConditionalOverride(
  block: ConditionalBlock,
  storyState: StoryState,
): ConditionalOverrideEntry | null {
  const sorted = [...block.overrides].sort((a, b) => a.order - b.order)
  for (const override of sorted) {
    if (matchesCondition(override.condition, storyState)) return override
  }
  return null
}

export function applyChoice(
  currentState: StoryState,
  currentHistory: HistoryEntry[],
  choicePointId: string,
  choice: ChoiceRecord,
): { newState: StoryState; newHistory: HistoryEntry[] } {
  const stateSnapshot = { ...currentState }
  const newState: StoryState = { ...currentState }
  for (const [name, instruction] of Object.entries(choice.setsVariables)) {
    newState[name] = applyVarOp(currentState[name], instruction)
  }
  return {
    newState,
    newHistory: [...currentHistory, { choicePointId, choiceId: choice.id, stateSnapshot }],
  }
}

export function rewindTo(
  history: HistoryEntry[],
  choicePointId: string,
): { restoredState: StoryState; truncatedHistory: HistoryEntry[] } {
  const index = history.findIndex(e => e.choicePointId === choicePointId)
  if (index === -1) throw new Error(`Choice point ${choicePointId} not found in history`)
  return {
    restoredState: history[index].stateSnapshot,
    truncatedHistory: history.slice(0, index),
  }
}
