type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

export default function ChapterGate({ prompt, choices, onChoose }: Props) {
  const yesChoice = choices.find(c => c.label === 'Yes')
  const noChoice  = choices.find(c => c.label === 'No')

  return (
    <div className="fixed inset-0 bg-surface-base/95 flex flex-col items-center justify-center z-50">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-4">— Chapter End —</div>
      {prompt && (
        <p className="text-ink text-lg font-medium mb-2 max-w-md text-center">{prompt}</p>
      )}
      <p className="text-ink-muted text-sm mb-10 italic">Your choice shapes what comes next.</p>
      <div className="flex gap-6">
        {yesChoice && (
          <button
            onClick={() => onChoose(yesChoice.id)}
            className="flex flex-col items-center gap-3 px-10 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 bg-choice-spare-bg border-choice-spare-border text-choice-spare"
          >
            <span className="text-3xl">✓</span>
            <span className="text-sm font-medium">Yes</span>
          </button>
        )}
        {noChoice && (
          <button
            onClick={() => onChoose(noChoice.id)}
            className="flex flex-col items-center gap-3 px-10 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 bg-choice-kill-bg border-choice-kill-border text-choice-kill"
          >
            <span className="text-3xl">✕</span>
            <span className="text-sm font-medium">No</span>
          </button>
        )}
      </div>
    </div>
  )
}
