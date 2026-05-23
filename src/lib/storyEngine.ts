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

export type ConditionalBlock = {
  overrides: Array<{
    id: string
    order: number
    condition: Condition
    content: string
  }>
}

export type ChoiceRecord = {
  id: string
  setsVariables: Record<string, boolean | number | string>
  targetChapterId: string | null
}

export function matchesCondition(condition: Condition, storyState: StoryState): boolean {
  if (isCompoundCondition(condition)) {
    const test = (cl: { var: string; value: ConditionLeafValue }) => storyState[cl.var] === cl.value
    return condition.op === 'or' ? condition.clauses.some(test) : condition.clauses.every(test)
  }
  return Object.entries(condition).every(([k, v]) => storyState[k] === v)
}

export function resolveConditional(block: ConditionalBlock, storyState: StoryState): string | null {
  const sorted = [...block.overrides].sort((a, b) => a.order - b.order)
  for (const override of sorted) {
    if (matchesCondition(override.condition, storyState)) return override.content
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
  return {
    newState: { ...currentState, ...choice.setsVariables },
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
