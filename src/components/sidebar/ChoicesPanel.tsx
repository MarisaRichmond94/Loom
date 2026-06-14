'use client'

import { useRouter } from 'next/navigation'

type ChoiceQuestion = {
  id: string
  prompt: string
  chapterId: string
  chapterTitle: string
  bookTitle: string
  reachable: boolean
}

type Props = {
  seriesId: string
  questions: ChoiceQuestion[]
}

export default function ChoicesPanel({ seriesId, questions }: Props) {
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2 shrink-0">Choices</div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {questions.length === 0 ? (
          <p className="text-xs text-ink-faint italic">No choices defined yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {questions.map(q => (
              <button
                key={q.id}
                onClick={() => router.push(`/author/${seriesId}/chapter/${q.chapterId}`)}
                // Reachable choices (those in chapters up to and including the
                // one being edited) render in full ink; later choices fade so
                // the writer can tell at a glance which questions are already
                // wired into the path leading to wherever they're working.
                className={`text-left text-xs px-2 py-1 rounded hover:bg-surface-overlay transition ${q.reachable ? 'text-ink hover:text-ink' : 'text-ink-faint hover:text-ink-muted'}`}
                title={`${q.bookTitle} › ${q.chapterTitle}${q.reachable ? '' : ' (downstream)'}`}
              >
                {q.prompt || <span className="italic text-ink-faint">Untitled question</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
