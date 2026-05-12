type Choice = { id: string; label: string }

type Props = {
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

const PALETTE = [
  { classes: 'bg-choice-spare-bg border-choice-spare-border text-choice-spare', emoji: '🕊' },
  { classes: 'bg-choice-kill-bg border-choice-kill-border text-choice-kill', emoji: '🗡' },
  { classes: 'bg-choice-amber-bg border-choice-amber-border text-choice-amber', emoji: '✨' },
  { classes: 'bg-choice-blue-bg border-choice-blue-border text-choice-blue', emoji: '💧' },
  { classes: 'bg-choice-purple-bg border-choice-purple-border text-choice-purple', emoji: '🌙' },
  { classes: 'bg-choice-teal-bg border-choice-teal-border text-choice-teal', emoji: '🔥' },
]

export default function ChapterGate({ choices, onChoose }: Props) {
  return (
    <div className="fixed inset-0 bg-surface-base/95 flex flex-col items-center justify-center z-50">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">— Chapter End —</div>
      <p className="text-ink-muted text-sm mb-10 italic">Your choice shapes what comes next.</p>
      <div className="flex flex-wrap justify-center gap-6">
        {choices.map((choice, i) => {
          const { classes, emoji } = PALETTE[i % PALETTE.length]
          return (
            <button
              key={choice.id}
              onClick={() => onChoose(choice.id)}
              className={`flex flex-col items-center gap-3 px-8 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 ${classes}`}
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-sm font-medium">{choice.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
