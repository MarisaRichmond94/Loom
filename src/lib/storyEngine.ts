export type StoryState = Record<string, boolean | number | string>

export type HistoryEntry = {
  choicePointId: string
  choiceId: string
  stateSnapshot: StoryState
}

export type ConditionalBlock = {
  baseContent: string
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

export function resolveConditional(block: ConditionalBlock, storyState: StoryState): string {
  const sorted = [...block.overrides].sort((a, b) => a.order - b.order)
  for (const override of sorted) {
    const matches = Object.entries(override.condition).every(([k, v]) => storyState[k] === v)
    if (matches) return override.content
  }
  return block.baseContent
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
