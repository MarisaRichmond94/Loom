export type StoryState = Record<string, boolean | number | string>

export type HistoryEntry = {
  choicePointId: string
  choiceId: string
  stateSnapshot: StoryState
}

export type ConditionalBlock = {
  overrides: Array<{
    id: string
    order: number
    condition: Record<string, boolean | number | string>
    content: string
  }>
}

export type ChoiceRecord = {
  id: string
  setsVariables: Record<string, boolean | number | string>
  targetChapterId: string | null
}

export function matchesCondition(
  condition: Record<string, boolean | number | string>,
  storyState: StoryState,
): boolean {
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
