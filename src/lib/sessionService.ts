import type { StoryState, HistoryEntry } from './storyEngine'

type VariableRow = { id: string; name: string; type: string; defaultValue: string }

export function buildInitialState(variables: VariableRow[]): StoryState {
  return Object.fromEntries(
    variables.map(v => [v.name, JSON.parse(v.defaultValue)])
  )
}

export function serializeSession(
  storyState: StoryState,
  choiceHistory: HistoryEntry[],
): { storyState: string; choiceHistory: string } {
  return {
    storyState: JSON.stringify(storyState),
    choiceHistory: JSON.stringify(choiceHistory),
  }
}

export function deserializeSession(
  storyState: string,
  choiceHistory: string,
): { storyState: StoryState; choiceHistory: HistoryEntry[] } {
  return {
    storyState: JSON.parse(storyState),
    choiceHistory: JSON.parse(choiceHistory),
  }
}
