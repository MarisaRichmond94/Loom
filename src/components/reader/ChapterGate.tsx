type Choice = { id: string; label: string }

type Props = {
  prompt: string | null
  choices: Choice[]
  onChoose: (choiceId: string) => void
}

// Same slot-by-index, render-custom-label rule as InlineChoice. The
// big ✓/✕ icons the chapter-gate used to show got dropped — they implied
// a yes/no binary that doesn't fit "A phone" / "A laptop". The label
// text itself carries the weight now.
export default function ChapterGate({ prompt, choices, onChoose }: Props) {
  const primary = choices[0] ?? null
  const secondary = choices[1] ?? null

  return (
    <div className="fixed inset-0 bg-surface-base/95 flex flex-col items-center justify-center z-50">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-4">— Chapter End —</div>
      {prompt && (
        <p className="text-ink text-lg font-medium mb-2 max-w-md text-center">{prompt}</p>
      )}
      <p className="text-ink-muted text-sm mb-10 italic">Your choice shapes what comes next.</p>
      <div className="flex gap-6">
        {primary && (
          <button
            onClick={() => onChoose(primary.id)}
            className="px-10 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 bg-choice-spare-bg border-choice-spare-border text-choice-spare text-base font-medium"
          >
            {primary.label.trim() || 'Choice 1'}
          </button>
        )}
        {secondary && (
          <button
            onClick={() => onChoose(secondary.id)}
            className="px-10 py-6 rounded-lg border min-w-[160px] transition hover:opacity-80 bg-choice-kill-bg border-choice-kill-border text-choice-kill text-base font-medium"
          >
            {secondary.label.trim() || 'Choice 2'}
          </button>
        )}
      </div>
    </div>
  )
}
