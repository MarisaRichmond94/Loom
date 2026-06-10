type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

// Slot by index, render the writer's custom label. The first choice gets
// the green "spare" color, the second gets the red "kill" color — the
// color treatment is now visual differentiation only, not a yes/no signal.
// Fallback placeholders kick in for choices saved before the writer
// renamed them.
export default function InlineChoice({ prompt, choices, onChoose }: Props) {
  const primary = choices[0] ?? null
  const secondary = choices[1] ?? null

  return (
    <div className="flex flex-col items-center">
      {prompt && (
        <p className="text-sm text-ink italic mb-3 text-center">{prompt}</p>
      )}
      <div className="flex gap-3">
        {primary && (
          <button
            onClick={() => onChoose(primary.id)}
            className="px-5 py-2 rounded border text-sm font-medium transition hover:opacity-80 bg-choice-spare-bg border-choice-spare-border text-white"
          >
            {primary.label.trim() || 'Choice 1'}
          </button>
        )}
        {secondary && (
          <button
            onClick={() => onChoose(secondary.id)}
            className="px-5 py-2 rounded border text-sm font-medium transition hover:opacity-80 bg-choice-kill-bg border-choice-kill-border text-white"
          >
            {secondary.label.trim() || 'Choice 2'}
          </button>
        )}
      </div>
    </div>
  )
}
