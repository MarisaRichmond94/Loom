type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

// Same position-based coloring rule as InlineChoice. The big ✓/✕ icons the
// chapter-gate used to show got dropped — they implied a yes/no binary that
// doesn't fit "A phone" / "A laptop". The label text carries the weight now.
const SLOT_STYLES = [
  'bg-choice-spare-bg border-choice-spare-border text-choice-spare',
  'bg-choice-kill-bg border-choice-kill-border text-choice-kill',
]
const EXTRA_STYLE = 'bg-surface-raised border-accent/40 text-ink'

export default function ChapterGate({ prompt, choices, onChoose }: Props) {
  return (
    <div className="fixed inset-0 bg-surface-base/95 flex flex-col items-center justify-center z-50">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-4">— Chapter End —</div>
      {prompt && (
        <p className="text-ink text-lg font-medium mb-2 max-w-md text-center">{prompt}</p>
      )}
      <p className="text-ink-muted text-sm mb-10 italic">Your choice shapes what comes next.</p>
      <div className="flex flex-wrap justify-center gap-6 max-w-3xl">
        {choices.map((choice, i) => (
          <button
            key={choice.id}
            onClick={() => onChoose(choice.id)}
            className={`px-10 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 text-base font-medium ${SLOT_STYLES[i] ?? EXTRA_STYLE}`}
          >
            {choice.label.trim() || `Choice ${i + 1}`}
          </button>
        ))}
      </div>
    </div>
  )
}
