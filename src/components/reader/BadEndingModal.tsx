'use client'

import { useEffect, useState } from 'react'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import type { ChapterLabel } from '@/lib/chapterLabels'

type Variable = { id: string; name: string; type: string; defaultValue: string }

type ChoicePoint = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  choices: { id: string; label: string; setsVariables: string }[]
}

type Props = {
  message: string
  sessionId: string
  seriesId: string
  choiceHistory: HistoryEntry[]
  variables: Variable[]
  chapterLabels?: Record<string, ChapterLabel>
  firstChapterId: string | null
  onApply: (state: StoryState, history: HistoryEntry[], navigateToChapterId: string, scrollToBlockId?: string) => void
}

export default function BadEndingModal({
  message, sessionId, seriesId, choiceHistory, variables, chapterLabels = {}, firstChapterId, onApply,
}: Props) {
  const [choicePoints, setChoicePoints] = useState<ChoicePoint[]>([])
  const [working, setWorking] = useState(false)

  useEffect(() => {
    fetch(`/api/series/${seriesId}/choice-points`)
      .then(r => r.ok ? r.json() : [])
      .then(setChoicePoints)
  }, [seriesId])

  // The bad-ending choice point is the most recent entry in history.
  // Eligible "go back" targets are every choice point that comes before it in story order.
  const badEndingEntry = choiceHistory[choiceHistory.length - 1]
  const badEndingIdx = badEndingEntry
    ? choicePoints.findIndex(cp => cp.id === badEndingEntry.choicePointId)
    : -1
  const eligibleCps = badEndingIdx >= 0 ? choicePoints.slice(0, badEndingIdx + 1) : choicePoints

  // Index history entries by story-order so we can show "chosen" labels next to each row
  // and so the rewind logic can compute state by replaying entries that come before the target.
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

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-8">
      <div className="bg-surface-raised border border-choice-kill/40 rounded-xl p-8 max-w-xl w-full shadow-2xl flex flex-col max-h-[80vh]">
        <p className="text-base text-ink leading-relaxed mb-6 whitespace-pre-wrap text-center">{message}</p>
        <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">Go back to</div>
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {(() => {
            // Filter out choice points in chapters whose condition currently fails
            // (decision: hidden chapters don't appear as rewind targets).
            const visibleCps = eligibleCps.filter(cp => chapterLabels[cp.chapterId]?.visible !== false)
            if (visibleCps.length === 0) {
              return <p className="text-xs text-ink-faint italic py-2">No earlier questions to return to.</p>
            }
            return (
              <div className="flex flex-col gap-1">
                {visibleCps.map(cp => {
                  const entry = choiceHistory.find(e => e.choicePointId === cp.id)
                  const chosen = entry ? cp.choices.find(c => c.id === entry.choiceId) : null
                  const label = chapterLabels[cp.chapterId]?.readerLabel ?? cp.chapterTitle
                  return (
                    <button
                      key={cp.id}
                      onClick={() => goTo(cp)}
                      disabled={working}
                      className="text-left px-3 py-2 rounded bg-surface-overlay border border-accent/10 hover:border-accent/40 transition disabled:opacity-50 flex items-baseline gap-3"
                    >
                      <span className="text-xs text-ink-faint shrink-0">{label}</span>
                      <span className="text-sm text-ink-muted flex-1 truncate">{cp.prompt}</span>
                      {chosen && (
                        <span className="text-xs text-ink-faint shrink-0">[{chosen.label}]</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })()}
        </div>
        {firstChapterId && (
          <button
            onClick={startOver}
            disabled={working}
            className="mt-4 text-xs text-ink-muted hover:text-ink transition py-2 border-t border-accent/10 disabled:opacity-50"
          >
            Start over from the beginning
          </button>
        )}
      </div>
    </div>
  )
}
