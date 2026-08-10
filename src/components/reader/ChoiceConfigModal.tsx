'use client'

import { useEffect, useMemo, useState } from 'react'
import { LuChevronDown, LuX } from 'react-icons/lu'
import { applyChoice } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry, ChoiceSetValue } from '@/lib/storyEngine'

type ChoicePoint = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  choices: { id: string; label: string; setsVariables: string }[]
}

type Variable = { id: string; name: string; type: string; defaultValue: string }

// Render one choice's setsVariables payload as short "name op value"
// fragments, e.g. "pregnancyHintCounter += 1" — shown under each choice
// so the writer can see what picking it would write before they commit.
function formatSetsVariables(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, ChoiceSetValue>
    return Object.entries(parsed).map(([name, v]) => {
      if (v !== null && typeof v === 'object') return `${name} ${v.op} ${v.value}`
      return `${name} = ${JSON.stringify(v)}`
    })
  } catch { return [] }
}

// Replays the current selections in book/chapter walk order to produce
// both the history the session PATCH needs and the resulting final
// state — the same computation apply() persists, reused here so the
// catalogue preview can never drift from what Apply actually does.
// Delegates each step to storyEngine's applyChoice so +=/-= choices
// fold against the accumulated value instead of overwriting it with
// the raw {op, value} instruction (a plain Object.assign merge would
// leave a counter variable holding that instruction object instead of
// a number the moment any choice used += or -=).
function computeConfiguration(
  selections: Record<string, string | null>,
  choicePoints: ChoicePoint[],
  variables: Variable[],
): { history: HistoryEntry[]; finalState: StoryState } {
  let state: StoryState = {}
  for (const v of variables) {
    try { state[v.name] = JSON.parse(v.defaultValue) } catch { /* ignore malformed */ }
  }
  let history: HistoryEntry[] = []
  for (const cp of choicePoints) {
    const choiceId = selections[cp.id]
    if (!choiceId) continue
    const choice = cp.choices.find(c => c.id === choiceId)
    if (!choice) continue
    let setsVariables: Record<string, ChoiceSetValue>
    try { setsVariables = JSON.parse(choice.setsVariables) } catch { setsVariables = {} }
    const result = applyChoice(state, history, cp.id, { id: choice.id, setsVariables, targetChapterId: null })
    state = result.newState
    history = result.newHistory
  }
  return { history, finalState: state }
}

type Props = {
  seriesId: string
  sessionId: string
  choiceHistory: HistoryEntry[]
  variables: Variable[]
  // When provided, enables the "focus on this chapter" filter — the modal
  // fetches that chapter's read-variables list and dims out unrelated
  // questions. Null/undefined falls back to the legacy show-all behavior.
  currentChapterId: string | null
  // Lifted state so the toggle in this modal takes effect on the reader
  // immediately — no need to hit Apply for a pure presentation setting.
  highlightConditionals: boolean
  onHighlightConditionalsChange: (next: boolean) => void
  onApply: (state: StoryState, history: HistoryEntry[]) => void
  onClose: () => void
}

export default function ChoiceConfigModal({ seriesId, sessionId, choiceHistory, variables, currentChapterId, highlightConditionals, onHighlightConditionalsChange, onApply, onClose }: Props) {
  const [choicePoints, setChoicePoints] = useState<ChoicePoint[]>([])
  const [selections, setSelections] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  // null while loading or when there's no chapter context. Empty array
  // means "this chapter reads nothing from series state" — the filter
  // still applies (with the empty-state copy below) so the writer sees
  // they're not missing relevant questions.
  const [readVars, setReadVars] = useState<Set<string> | null>(null)
  // On by default when we have a chapter context, off otherwise. The
  // writer flips it via the toggle next to the modal header.
  const [filterEnabled, setFilterEnabled] = useState<boolean>(!!currentChapterId)
  // Collapsed by default — the catalogue is a reference/debugging aid,
  // not something that needs to compete with the question list for
  // attention every time the modal opens.
  const [catalogOpen, setCatalogOpen] = useState(false)

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

  // Pull the read-variables list once we have a chapter context. Failure
  // (e.g. 404) silently disables the filter — the modal still works,
  // just without focus.
  useEffect(() => {
    if (!currentChapterId) { setReadVars(null); return }
    let cancelled = false
    fetch(`/api/chapters/${currentChapterId}/read-variables`)
      .then(r => r.ok ? r.json() : [])
      .then((data: string[]) => {
        if (cancelled) return
        setReadVars(new Set(data))
      })
      .catch(() => { if (!cancelled) setReadVars(null) })
    return () => { cancelled = true }
  }, [currentChapterId])

  // Live preview of the resulting context given the current selections —
  // drives the catalogue at the bottom of the modal. Recomputed whenever
  // a selection, the choice-point list, or the variable defaults change.
  const finalState = useMemo(
    () => computeConfiguration(selections, choicePoints, variables).finalState,
    [selections, choicePoints, variables],
  )

  async function apply() {
    setApplying(true)
    const { history: newHistory, finalState: newState } = computeConfiguration(selections, choicePoints, variables)
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

  // Resets every selection — both filtered-in and filtered-out — back to
  // unanswered. Doesn't PATCH on its own; the writer still has to hit
  // Apply for it to persist.
  function resetToDefaults() {
    const cleared: Record<string, string | null> = {}
    for (const cp of choicePoints) cleared[cp.id] = null
    setSelections(cleared)
  }

  // Decide which questions to render. When the filter is on AND we have
  // a read-variables list, keep only questions whose answers write to
  // one of those variables (any key from any choice's setsVariables).
  // Otherwise pass through the full list.
  const filterActive = filterEnabled && readVars !== null
  const visiblePoints = filterActive
    ? choicePoints.filter(cp => cp.choices.some(c => {
        try {
          const written = Object.keys(JSON.parse(c.setsVariables || '{}'))
          return written.some(name => readVars!.has(name))
        } catch { return false }
      }))
    : choicePoints

  // Group choice points by book → chapter for display
  const grouped: { bookTitle: string; chapters: { chapterId: string; chapterTitle: string; items: ChoicePoint[] }[] }[] = []
  for (const cp of visiblePoints) {
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
        <p className="text-xs text-ink-faint mb-3 italic">
          Set how the reader would have answered each question, then apply to reload the chapter with that state.
        </p>
        <div className="flex flex-col gap-1.5 mb-4">
          {currentChapterId && (
            <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterEnabled}
                onChange={e => setFilterEnabled(e.target.checked)}
                className="accent-accent"
              />
              <span>Show only questions that affect this chapter</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={highlightConditionals}
              onChange={e => onHighlightConditionalsChange(e.target.checked)}
              className="accent-accent"
            />
            <span>Color-code conditional text in the reader</span>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <p className="text-sm text-ink-faint italic text-center py-8">Loading…</p>
          ) : choicePoints.length === 0 ? (
            <p className="text-sm text-ink-faint italic text-center py-8">No choice points in this series yet.</p>
          ) : visiblePoints.length === 0 && filterActive ? (
            <p className="text-sm text-ink-faint italic text-center py-8">
              Nothing in this chapter depends on series state — it renders the same under every configuration.
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
                            <div className="flex gap-2 flex-wrap items-start">
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
                              {cp.choices.map(choice => {
                                const sets = formatSetsVariables(choice.setsVariables)
                                return (
                                  <button
                                    key={choice.id}
                                    onClick={() => setSelections(s => ({ ...s, [cp.id]: choice.id }))}
                                    className={`flex flex-col items-start gap-0.5 px-3 py-1 rounded text-xs text-left transition border ${
                                      selections[cp.id] === choice.id
                                        ? 'bg-accent/20 border-accent/40 text-ink font-medium'
                                        : 'border-accent/10 text-ink-faint hover:text-ink'
                                    }`}
                                  >
                                    <span>{choice.label}</span>
                                    {sets.length > 0 && (
                                      <span className="font-mono text-[10px] font-normal text-ink-faint">
                                        {sets.join(' · ')}
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
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

          {!loading && choicePoints.length > 0 && (
            <div className="mt-6 pt-4 border-t border-accent/10">
              <button
                type="button"
                onClick={() => setCatalogOpen(o => !o)}
                aria-expanded={catalogOpen}
                className="flex w-full items-center gap-2 text-left text-xs text-ink-muted hover:text-ink transition"
              >
                <span className="uppercase tracking-widest font-medium">Finalized context catalogue</span>
                <span className="text-ink-faint">
                  {Object.keys(finalState).length === 1 ? '1 variable' : `${Object.keys(finalState).length} variables`}
                </span>
                <LuChevronDown
                  size={13}
                  className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${catalogOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* 0fr/1fr grid trick animates open/closed without measuring content height. */}
              <div
                className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${
                  catalogOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="mt-3 rounded-lg border border-accent/10 bg-surface-overlay p-3">
                    {Object.keys(finalState).length === 0 ? (
                      <p className="text-xs text-ink-faint italic text-center py-1">No context variables yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {Object.entries(finalState)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([name, value]) => (
                            <div key={name} className="flex items-center gap-2 text-xs font-mono">
                              <span className="text-accent flex-1 min-w-0 truncate">{name}</span>
                              <span className="text-ink-muted">{JSON.stringify(value)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center pt-4 mt-2 border-t border-accent/10">
          <button
            onClick={resetToDefaults}
            disabled={loading || applying}
            className="text-xs text-ink-faint hover:text-ink transition disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <div className="ml-auto flex gap-3">
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
    </div>
  )
}
