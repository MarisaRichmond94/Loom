'use client'

import { useEffect, useState } from 'react'
import { LuX, LuRoute } from 'react-icons/lu'
import { applyChoice, type StoryState, type HistoryEntry, type ChoiceSetValue } from '@/lib/storyEngine'
import { buildStoryState } from '@/lib/chapterResolve'

type ChoicePoint = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  choices: { id: string; label: string; setsVariables: string }[]
}

type Variable = { id: string; name: string; type: string; defaultValue?: string }

type Props = {
  seriesId: string
  currentChapterId: string
  variables: Variable[]
  // Selections to restore when the panel reopens (persisted by the page).
  initialSelections: Record<string, string | null>
  // Hands back the resolved lens state (null when nothing is answered, which
  // clears the lens) plus the raw selections so the page can persist them.
  onApply: (state: StoryState | null, selections: Record<string, string | null>) => void
  onClose: () => void
}

// The write-mode twin of the reader's Configure Choices modal: same questions,
// same chapter-scoped filter, but instead of seeding a reading session it
// resolves the answers into a StoryState the editor uses as a "path lens" —
// dimming every block, override, and branch that isn't on the chosen path.
export default function PathConfigModal({ seriesId, currentChapterId, variables, initialSelections, onApply, onClose }: Props) {
  const [choicePoints, setChoicePoints] = useState<ChoicePoint[]>([])
  const [selections, setSelections] = useState<Record<string, string | null>>(initialSelections)
  const [loading, setLoading] = useState(true)
  const [readVars, setReadVars] = useState<Set<string> | null>(null)
  const [filterEnabled, setFilterEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/choice-points`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: ChoicePoint[]) => {
        if (cancelled) return
        setChoicePoints(data)
        // Keep any restored selection that still points at a live choice;
        // drop stale ones so a deleted branch can't linger in the lens.
        setSelections(prev => {
          const valid: Record<string, string | null> = {}
          for (const cp of data) {
            const chosen = prev[cp.id]
            valid[cp.id] = chosen && cp.choices.some(c => c.id === chosen) ? chosen : null
          }
          return valid
        })
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seriesId])

  // Which variables this chapter actually reads — powers the focus filter.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/chapters/${currentChapterId}/read-variables`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: string[]) => {
        if (!cancelled) setReadVars(new Set(data))
      })
      .catch(() => {
        if (!cancelled) setReadVars(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentChapterId])

  // Fold the answered choices into a StoryState the same way a real
  // playthrough would (applyChoice honours += / -= counters), seeded from the
  // series defaults. Returns null when nothing is answered so the caller can
  // clear the lens entirely.
  function buildState(): StoryState | null {
    let state = buildStoryState(variables)
    let history: HistoryEntry[] = []
    let answered = false
    for (const cp of choicePoints) {
      const choiceId = selections[cp.id]
      if (!choiceId) continue
      const choice = cp.choices.find(c => c.id === choiceId)
      if (!choice) continue
      answered = true
      let sets: Record<string, ChoiceSetValue> = {}
      try {
        sets = JSON.parse(choice.setsVariables || '{}')
      } catch {
        /* malformed — treat as no-op */
      }
      const res = applyChoice(state, history, cp.id, { id: choice.id, setsVariables: sets, targetChapterId: null })
      state = res.newState
      history = res.newHistory
    }
    return answered ? state : null
  }

  function apply() {
    onApply(buildState(), selections)
  }

  function clearPath() {
    const cleared: Record<string, string | null> = {}
    for (const cp of choicePoints) cleared[cp.id] = null
    setSelections(cleared)
    onApply(null, cleared)
  }

  const filterActive = filterEnabled && readVars !== null
  const visiblePoints = filterActive
    ? choicePoints.filter(cp =>
        cp.choices.some(c => {
          try {
            return Object.keys(JSON.parse(c.setsVariables || '{}')).some(name => readVars!.has(name))
          } catch {
            return false
          }
        }),
      )
    : choicePoints

  // Group by book → chapter for display.
  const grouped: { bookTitle: string; chapters: { chapterId: string; chapterTitle: string; items: ChoicePoint[] }[] }[] = []
  for (const cp of visiblePoints) {
    let book = grouped.find(b => b.bookTitle === cp.bookTitle)
    if (!book) {
      book = { bookTitle: cp.bookTitle, chapters: [] }
      grouped.push(book)
    }
    let chapter = book.chapters.find(c => c.chapterId === cp.chapterId)
    if (!chapter) {
      chapter = { chapterId: cp.chapterId, chapterTitle: cp.chapterTitle, items: [] }
      book.chapters.push(chapter)
    }
    chapter.items.push(cp)
  }

  const answeredCount = choicePoints.filter(cp => selections[cp.id]).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 py-16" onClick={onClose}>
      <div
        className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">
          <LuX size={18} />
        </button>
        <h2 className="text-base font-bold text-ink mb-2 pr-6 uppercase tracking-widest flex items-center gap-2">
          <LuRoute size={16} className="text-accent" /> Configure Path
        </h2>
        <p className="text-xs text-ink-faint mb-3 italic">
          Answer each question as the reader would. The editor highlights the text on that path and dims everything else — and Copy uses the same path.
        </p>
        <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none mb-4">
          <input type="checkbox" checked={filterEnabled} onChange={e => setFilterEnabled(e.target.checked)} className="accent-accent" />
          <span>Show only questions that affect this chapter</span>
        </label>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <p className="text-sm text-ink-faint italic text-center py-8">Loading…</p>
          ) : choicePoints.length === 0 ? (
            <p className="text-sm text-ink-faint italic text-center py-8">No choice points in this series yet.</p>
          ) : visiblePoints.length === 0 && filterActive ? (
            <p className="text-sm text-ink-faint italic text-center py-8">
              Nothing in this chapter depends on series state — it renders the same on every path.
            </p>
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
                                  {choice.label || 'Untitled'}
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

        <div className="flex items-center pt-4 mt-2 border-t border-accent/10">
          <button
            onClick={clearPath}
            disabled={loading || answeredCount === 0}
            className="text-xs text-ink-faint hover:text-ink transition disabled:opacity-40"
          >
            Clear path
          </button>
          <div className="ml-auto flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
            >
              Apply Path
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
