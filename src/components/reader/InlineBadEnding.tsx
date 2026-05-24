'use client'

import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import type { ChapterLabel } from '@/lib/chapterLabels'
import { useBadEndingRewind } from './useBadEndingRewind'

type Variable = { id: string; name: string; type: string; defaultValue: string }

type Props = {
  sessionId: string
  seriesId: string
  choiceHistory: HistoryEntry[]
  variables: Variable[]
  chapterLabels?: Record<string, ChapterLabel>
  firstChapterId: string | null
  onApply: (state: StoryState, history: HistoryEntry[], navigateToChapterId: string, scrollToBlockId?: string) => void
}

// Rewind controls rendered at the bottom of a chapter when a conditional
// bad-ending fires. Treated like the end of the book: the override's prose
// renders inline above, the rest of the chapter is truncated, and the
// reader picks an earlier decision point or starts over here.
export default function InlineBadEnding({
  sessionId, seriesId, choiceHistory, variables, chapterLabels, firstChapterId, onApply,
}: Props) {
  const { visibleCps, working, goTo, startOver } = useBadEndingRewind({
    sessionId, seriesId, choiceHistory, variables, chapterLabels, firstChapterId, onApply,
  })

  return (
    <div className="mt-10 pt-6 border-t border-choice-kill/30">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-3">Go back to</div>
      {visibleCps.length === 0 ? (
        <p className="text-xs text-ink-faint italic py-2">No earlier questions to return to.</p>
      ) : (
        <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto -mx-2 px-2">
          {visibleCps.map(cp => {
            const entry = choiceHistory.find(e => e.choicePointId === cp.id)
            const chosen = entry ? cp.choices.find(c => c.id === entry.choiceId) : null
            const label = chapterLabels?.[cp.chapterId]?.readerLabel ?? cp.chapterTitle
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
      )}
      {firstChapterId && (
        <button
          onClick={startOver}
          disabled={working}
          className="mt-4 w-full text-xs text-ink-muted hover:text-ink transition py-2 border-t border-accent/10 disabled:opacity-50"
        >
          Start over from the beginning
        </button>
      )}
    </div>
  )
}
