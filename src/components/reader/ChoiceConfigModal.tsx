'use client'

import { useEffect, useState } from 'react'
import { LuX } from 'react-icons/lu'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'

type ChoicePoint = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  choices: { id: string; label: string; setsVariables: string }[]
}

type Variable = { id: string; name: string; type: string; defaultValue: string }

type Props = {
  seriesId: string
  sessionId: string
  choiceHistory: HistoryEntry[]
  variables: Variable[]
  onApply: (state: StoryState, history: HistoryEntry[]) => void
  onClose: () => void
}

export default function ChoiceConfigModal({ seriesId, sessionId, choiceHistory, variables, onApply, onClose }: Props) {
  const [choicePoints, setChoicePoints] = useState<ChoicePoint[]>([])
  const [selections, setSelections] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/choice-points`)
      .then(r => r.ok ? r.json() : [])
      .then((data: ChoicePoint[]) => {
        if (cancelled) return
        setChoicePoints(data)
        const initial: Record<string, string | null> = {}
        for (const cp of data) {
          const answer = choiceHistory.find(h => h.choicePointId === cp.id)
          initial[cp.id] = answer ? answer.choiceId : null
        }
        setSelections(initial)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [seriesId, choiceHistory])

  async function apply() {
    setApplying(true)
    // Seed with variable defaults so variables never set by a chosen path
    // still resolve to their declared default (matches buildInitialState behavior).
    const newState: StoryState = {}
    for (const v of variables) {
      try { newState[v.name] = JSON.parse(v.defaultValue) } catch { /* ignore malformed */ }
    }
    const newHistory: HistoryEntry[] = []
    for (const cp of choicePoints) {
      const choiceId = selections[cp.id]
      if (!choiceId) continue
      const choice = cp.choices.find(c => c.id === choiceId)
      if (!choice) continue
      const stateSnapshot = { ...newState }
      newHistory.push({ choicePointId: cp.id, choiceId: choice.id, stateSnapshot })
      Object.assign(newState, JSON.parse(choice.setsVariables))
    }
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyState: newState, choiceHistory: newHistory }),
    })
    if (!res.ok) {
      setApplying(false)
      return
    }
    onApply(newState, newHistory)
  }

  // Group choice points by book → chapter for display
  const grouped: { bookTitle: string; chapters: { chapterId: string; chapterTitle: string; items: ChoicePoint[] }[] }[] = []
  for (const cp of choicePoints) {
    let book = grouped.find(b => b.bookTitle === cp.bookTitle)
    if (!book) { book = { bookTitle: cp.bookTitle, chapters: [] }; grouped.push(book) }
    let chapter = book.chapters.find(c => c.chapterId === cp.chapterId)
    if (!chapter) { chapter = { chapterId: cp.chapterId, chapterTitle: cp.chapterTitle, items: [] }; book.chapters.push(chapter) }
    chapter.items.push(cp)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 py-16" onClick={onClose}>
      <div
        className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">
          <LuX size={18} />
        </button>
        <h2 className="text-base font-bold text-ink mb-2 pr-6 uppercase tracking-widest">Configure Choices</h2>
        <p className="text-xs text-ink-faint mb-6 italic">
          Set how the reader would have answered each question, then apply to reload the chapter with that state.
        </p>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <p className="text-sm text-ink-faint italic text-center py-8">Loading…</p>
          ) : choicePoints.length === 0 ? (
            <p className="text-sm text-ink-faint italic text-center py-8">No choice points in this series yet.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {grouped.map(book => (
                <div key={book.bookTitle}>
                  <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">{book.bookTitle}</div>
                  {book.chapters.map(chapter => (
                    <div key={chapter.chapterId} className="mb-4">
                      <div className="text-xs text-ink-muted mb-2">{chapter.chapterTitle}</div>
                      <div className="flex flex-col gap-3">
                        {chapter.items.map(cp => (
                          <div key={cp.id} className="bg-surface-overlay border border-accent/10 rounded-lg p-3">
                            <p className="text-sm text-ink mb-2 italic">{cp.prompt}</p>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => setSelections(s => ({ ...s, [cp.id]: null }))}
                                className={`px-3 py-1 rounded text-xs transition border ${
                                  selections[cp.id] == null
                                    ? 'bg-surface-muted border-accent/40 text-ink'
                                    : 'border-accent/10 text-ink-faint hover:text-ink'
                                }`}
                              >
                                Unanswered
                              </button>
                              {cp.choices.map(choice => (
                                <button
                                  key={choice.id}
                                  onClick={() => setSelections(s => ({ ...s, [cp.id]: choice.id }))}
                                  className={`px-3 py-1 rounded text-xs transition border ${
                                    selections[cp.id] === choice.id
                                      ? 'bg-accent/20 border-accent/40 text-ink font-medium'
                                      : 'border-accent/10 text-ink-faint hover:text-ink'
                                  }`}
                                >
                                  {choice.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-accent/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">Cancel</button>
          <button
            onClick={apply}
            disabled={loading || applying}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
