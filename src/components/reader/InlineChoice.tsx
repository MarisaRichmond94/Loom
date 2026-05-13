type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

export default function InlineChoice({ prompt, choices, onChoose }: Props) {
  const yesChoice = choices.find(c => c.label === 'Yes')
  const noChoice  = choices.find(c => c.label === 'No')

  return (
    <div className="border-t border-accent/10 pt-4 mt-4 flex flex-col items-center">
      {prompt && (
        <p className="text-sm text-ink italic mb-3 text-center">{prompt}</p>
      )}
      <div className="flex gap-3">
        {yesChoice && (
          <button
            onClick={() => onChoose(yesChoice.id)}
            className="px-5 py-2 rounded border text-sm font-medium transition hover:opacity-80 bg-choice-spare-bg border-choice-spare-border text-white"
          >
            Yes
          </button>
        )}
        {noChoice && (
          <button
            onClick={() => onChoose(noChoice.id)}
            className="px-5 py-2 rounded border text-sm font-medium transition hover:opacity-80 bg-choice-kill-bg border-choice-kill-border text-white"
          >
            No
          </button>
        )}
      </div>
    </div>
  )
}
