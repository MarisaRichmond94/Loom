type Choice = { id: string; label: string }

type Props = {
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

const PALETTE = [
  'bg-choice-spare-bg border-choice-spare-border text-choice-spare',
  'bg-choice-kill-bg border-choice-kill-border text-choice-kill',
  'bg-choice-amber-bg border-choice-amber-border text-choice-amber',
  'bg-choice-blue-bg border-choice-blue-border text-choice-blue',
  'bg-choice-purple-bg border-choice-purple-border text-choice-purple',
  'bg-choice-teal-bg border-choice-teal-border text-choice-teal',
]

export default function InlineChoice({ choices, onChoose }: Props) {
  return (
    <div className="border-t border-accent/10 pt-4 mt-4">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-3">What happens next?</div>
      <div className="flex flex-col gap-2">
        {choices.map((choice, i) => (
          <button
            key={choice.id}
            onClick={() => onChoose(choice.id)}
            className={`text-left px-4 py-2.5 rounded border text-sm transition hover:opacity-80 ${PALETTE[i % PALETTE.length]}`}
          >
            → {choice.label}
          </button>
        ))}
      </div>
    </div>
  )
}
