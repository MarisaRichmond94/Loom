type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

// Color by position — the writer's custom label carries the meaning; the
// color is visual differentiation only, not a yes/no signal. The first two
// (base) options keep the green "spare" / red "kill" treatment; any gated
// extras that passed their condition render in the neutral accent style.
// Fallback placeholders kick in for options saved before the writer renamed
// them.
const SLOT_STYLES = [
  'bg-choice-spare-bg border-choice-spare-border text-white',
  'bg-choice-kill-bg border-choice-kill-border text-white',
]
const EXTRA_STYLE = 'bg-surface-raised border-accent/40 text-ink'

export default function InlineChoice({ prompt, choices, onChoose }: Props) {
  return (
    <div className="flex flex-col items-center">
      {prompt && (
        <p className="text-sm text-ink italic mb-3 text-center">{prompt}</p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {choices.map((choice, i) => (
          <button
            key={choice.id}
            onClick={() => onChoose(choice.id)}
            className={`px-5 py-2 rounded border text-sm font-medium transition hover:opacity-80 ${SLOT_STYLES[i] ?? EXTRA_STYLE}`}
          >
            {choice.label.trim() || `Choice ${i + 1}`}
          </button>
        ))}
      </div>
    </div>
  )
}
