type Choice = { id: string; label: string }

type Props = {
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

export default function ChapterGate({ choices, onChoose }: Props) {
  return (
    <div className="fixed inset-0 bg-surface-base/95 flex flex-col items-center justify-center z-50">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">— Chapter End —</div>
      <p className="text-ink-muted text-sm mb-10 italic">Your choice shapes what comes next.</p>
      <div className="flex gap-6">
        {choices.map((choice, i) => (
          <button
            key={choice.id}
            onClick={() => onChoose(choice.id)}
            className={`flex flex-col items-center gap-3 px-8 py-6 rounded-lg border min-w-[160px] transition ${
              i % 2 === 0
                ? 'bg-choice-spare-bg border-choice-spare-border text-choice-spare hover:opacity-80'
                : 'bg-choice-kill-bg border-choice-kill-border text-choice-kill hover:opacity-80'
            }`}
          >
            <span className="text-3xl">{i % 2 === 0 ? '🕊' : '🗡'}</span>
            <span className="text-sm font-medium">{choice.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
