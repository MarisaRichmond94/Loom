export type StoryState = Record<string, boolean | number | string>

export type HistoryEntry = {
  choicePointId: string
  choiceId: string
  stateSnapshot: StoryState
}

// Conditions can be stored in two shapes that the engine reads transparently:
//   1. Legacy: `{ varA: 1, varB: 2 }` — implicit AND of equalities. Continues to be
//      the on-disk format for single-variable or all-AND conditions (no migration).
//   2. Compound: `{ op: 'and' | 'or', clauses: [{ var, value, cmp? }, ...] }` —
//      explicit operator. The editor writes this whenever the legacy object
//      can't express the gate: an OR, a hide-if polarity, or any clause using a
//      comparison operator (cmp other than '='), since `{ var: value }` has no
//      slot for one.
export type ConditionLeafValue = boolean | number | string
// Per-clause comparison operator. Absent (and '=') means strict equality —
// the only relation legacy data ever implied — so an absent cmp keeps every
// existing condition evaluating exactly as before. '>' '<' '>=' '<=' are
// numeric-only (see compareClause) and let a number variable gate on a range
// rather than an exact value.
export type ConditionCmp = '=' | '>' | '<' | '>=' | '<='
export type ConditionClauseShape = { var: string; value: ConditionLeafValue; cmp?: ConditionCmp }
export type LegacyCondition = Record<string, ConditionLeafValue>
export type CompoundCondition = {
  op: 'and' | 'or'
  clauses: ConditionClauseShape[]
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
  // When true, a matched override cleanly ends the chapter: content renders,
  // then every block after this fragment is dropped and the reader advances
  // normally (no death modal, no rewind). If endingMessage is also set, the
  // bad ending wins.
  endsChapter?: boolean
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

// Evaluate one clause against state. Absent cmp (and '=') is strict equality —
// byte-for-byte the pre-comparison behavior, so existing conditions are
// unaffected. The ordering operators are numeric-only: if either side isn't a
// real number (the variable was never set, or isn't a number type) the clause
// fails rather than coercing — matching how equality already fails on unset
// variables.
function compareClause(cl: ConditionClauseShape, storyState: StoryState): boolean {
  const cmp = cl.cmp ?? '='
  if (cmp === '=') return storyState[cl.var] === cl.value
  const a = storyState[cl.var]
  const b = cl.value
  if (typeof a !== 'number' || typeof b !== 'number') return false
  switch (cmp) {
    case '>': return a > b
    case '<': return a < b
    case '>=': return a >= b
    case '<=': return a <= b
  }
  return false
}

export function matchesCondition(condition: Condition, storyState: StoryState): boolean {
  if (isCompoundCondition(condition)) {
    const test = (cl: ConditionClauseShape) => compareClause(cl, storyState)
    const matched = condition.op === 'or' ? condition.clauses.some(test) : condition.clauses.every(test)
    // mode='hide' inverts: the chapter is "visible" when the clauses DON'T match.
    // Block overrides never set this mode, so override resolution is unaffected.
    return condition.mode === 'hide' ? !matched : matched
  }
  return Object.entries(condition).every(([k, v]) => storyState[k] === v)
}

// Compute the smallest state patch that flips a condition from failing to
// passing. Used by the reader when a writer previews a gated chapter that
// the defaults can't reach: rather than silently redirect them to the
// nearest visible chapter, seed the session with just enough to make the
// requested chapter visible.
//
// Strategy by shape:
//   - show-if + AND (or legacy implicit AND): set every clause's variable
//     to its required value.
//   - show-if + OR: set the first clause; that alone satisfies the OR.
//   - hide-if + AND: clauses match → hidden; flip the first clause to
//     break the AND. Boolean only — non-boolean "non-matching" values
//     are ambiguous and skipped.
//   - hide-if + OR: any clause matching hides → push every clause to a
//     non-matching value. Boolean only.
//
// Returns null when the shape can't be solved with simple flips (e.g. a
// hide-if condition on a non-boolean variable). Callers fall back to
// the previous behavior (redirect to the closest visible chapter).
export function solveCondition(
  condition: Condition,
  variables: Array<{ name: string; type: string }>,
): StoryState | null {
  const typeByName: Record<string, string> = {}
  for (const v of variables) typeByName[v.name] = v.type

  function flip(value: ConditionLeafValue, varName: string): ConditionLeafValue | null {
    if (typeof value === 'boolean') return !value
    if (typeByName[varName] === 'boolean') return !Boolean(value)
    return null
  }

  // Smallest value that makes one show-if clause pass. Equality wants the exact
  // value; ordering clauses step one past the threshold (value±1 is > / < the
  // threshold for any real number, and value itself satisfies >= / <=). A
  // non-numeric ordering clause can't be seeded, so the whole solve bails to
  // null (caller redirects) rather than guess.
  function satisfy(clause: ConditionClauseShape): ConditionLeafValue | null {
    const cmp = clause.cmp ?? '='
    if (cmp === '=') return clause.value
    if (typeof clause.value !== 'number') return null
    switch (cmp) {
      case '>': return clause.value + 1
      case '>=': return clause.value
      case '<': return clause.value - 1
      case '<=': return clause.value
    }
    return null
  }

  if (isCompoundCondition(condition)) {
    if (condition.clauses.length === 0) return null
    const isHide = condition.mode === 'hide'
    if (!isHide) {
      if (condition.op === 'or') {
        const c = condition.clauses[0]
        const target = satisfy(c)
        return target === null ? null : { [c.var]: target }
      }
      const patch: StoryState = {}
      for (const c of condition.clauses) {
        const target = satisfy(c)
        if (target === null) return null
        patch[c.var] = target
      }
      return patch
    }
    if (condition.op === 'and') {
      const c = condition.clauses[0]
      const flipped = flip(c.value, c.var)
      return flipped === null ? null : { [c.var]: flipped }
    }
    const patch: StoryState = {}
    for (const c of condition.clauses) {
      const flipped = flip(c.value, c.var)
      if (flipped === null) return null
      patch[c.var] = flipped
    }
    return patch
  }
  return { ...condition }
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
