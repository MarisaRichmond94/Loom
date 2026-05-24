'use client'

import { useEffect, useState } from 'react'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import type { ChapterLabel } from '@/lib/chapterLabels'

type Variable = { id: string; name: string; type: string; defaultValue: string }

export type ChoicePoint = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  choices: { id: string; label: string; setsVariables: string }[]
}

// Shared rewind logic used by both the choice-triggered BadEndingModal
// overlay and the inline rewind controls rendered after a bad-ending
// conditional block. Owns the choice-point fetch, the state-replay maths,
// and the session PATCH; consumers just render the UI.
export function useBadEndingRewind(opts: {
  sessionId: string
  seriesId: string
  choiceHistory: HistoryEntry[]
  variables: Variable[]
  chapterLabels?: Record<string, ChapterLabel>
  firstChapterId: string | null
  onApply: (state: StoryState, history: HistoryEntry[], navigateToChapterId: string, scrollToBlockId?: string) => void
}) {
  const {
    sessionId, seriesId, choiceHistory, variables, chapterLabels = {}, firstChapterId, onApply,
  } = opts

  const [choicePoints, setChoicePoints] = useState<ChoicePoint[]>([])
  const [working, setWorking] = useState(false)

  useEffect(() => {
    fetch(`/api/series/${seriesId}/choice-points`)
      .then(r => r.ok ? r.json() : [])
      .then(setChoicePoints)
  }, [seriesId])

  // The bad-ending anchor is the most recent answered choice point —
  // eligible rewind targets are everything up to and including it in
  // story order. Works for both choice-triggered endings (the trigger
  // IS the most recent choice) and conditional-triggered endings (the
  // most recent answered choice gates the rewind list).
  const badEndingEntry = choiceHistory[choiceHistory.length - 1]
  const badEndingIdx = badEndingEntry
    ? choicePoints.findIndex(cp => cp.id === badEndingEntry.choicePointId)
    : -1
  const eligibleCps = badEndingIdx >= 0 ? choicePoints.slice(0, badEndingIdx + 1) : choicePoints

  function storyIndexOf(choicePointId: string): number {
    return choicePoints.findIndex(cp => cp.id === choicePointId)
  }

  async function goTo(targetCp: ChoicePoint) {
    if (working) return
    setWorking(true)
    const targetIdx = storyIndexOf(targetCp.id)
    const replayEntries = choiceHistory
      .filter(e => {
        const idx = storyIndexOf(e.choicePointId)
        return idx >= 0 && idx < targetIdx
      })
      .sort((a, b) => storyIndexOf(a.choicePointId) - storyIndexOf(b.choicePointId))

    const newState: StoryState = {}
    for (const v of variables) {
      try { newState[v.name] = JSON.parse(v.defaultValue) } catch { /* ignore */ }
    }
    const newHistory: HistoryEntry[] = []
    for (const entry of replayEntries) {
      const cp = choicePoints.find(c => c.id === entry.choicePointId)
      if (!cp) continue
      const choice = cp.choices.find(c => c.id === entry.choiceId)
      if (!choice) continue
      const stateSnapshot = { ...newState }
      newHistory.push({ choicePointId: entry.choicePointId, choiceId: entry.choiceId, stateSnapshot })
      Object.assign(newState, JSON.parse(choice.setsVariables))
    }

    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyState: newState, choiceHistory: newHistory }),
    })
    if (!res.ok) { setWorking(false); return }
    onApply(newState, newHistory, targetCp.chapterId, targetCp.id)
  }

  async function startOver() {
    if (working || !firstChapterId) return
    setWorking(true)
    const initial: StoryState = {}
    for (const v of variables) {
      try { initial[v.name] = JSON.parse(v.defaultValue) } catch { /* ignore */ }
    }
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyState: initial, choiceHistory: [] }),
    })
    if (!res.ok) { setWorking(false); return }
    onApply(initial, [], firstChapterId)
  }

  // Hide rewind targets that sit inside a chapter whose condition currently
  // fails — those chapters aren't reachable from the current state anyway.
  const visibleCps = eligibleCps.filter(cp => chapterLabels[cp.chapterId]?.visible !== false)

  return {
    visibleCps,
    working,
    choiceHistory,
    chapterLabels,
    firstChapterId,
    goTo,
    startOver,
  }
}
