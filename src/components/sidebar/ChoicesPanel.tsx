'use client'

import { useRouter } from 'next/navigation'

type ChoiceQuestion = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
}

type Props = {
  seriesId: string
  questions: ChoiceQuestion[]
  onAddChoice?: () => void
}

export default function ChoicesPanel({ seriesId, questions, onAddChoice }: Props) {
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2 shrink-0">Choices</div>

      {/* Scrollable questions */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {questions.length === 0 ? (
          <p className="text-xs text-ink-faint italic">No choices defined yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {questions.map(q => (
              <button
                key={q.id}
                onClick={() => router.push(`/author/${seriesId}/chapter/${q.chapterId}`)}
                className="text-left text-xs text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-surface-overlay transition"
                title={`${q.bookTitle} › ${q.chapterTitle}`}
              >
                {q.prompt || <span className="italic text-ink-faint">Untitled question</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add Choice — fixed at bottom */}
      <div className="shrink-0 pt-2">
        <span
          title={!onAddChoice ? 'Navigate to a chapter to add a choice' : undefined}
          className="block"
        >
          <button
            onClick={onAddChoice}
            disabled={!onAddChoice}
            className="w-full px-2 py-1 text-xs bg-accent text-white rounded font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Choice
          </button>
        </span>
      </div>
    </div>
  )
}
