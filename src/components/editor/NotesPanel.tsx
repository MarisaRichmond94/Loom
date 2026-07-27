'use client'

// The chapter's private scratchpad. Deliberately a plain textarea rather than a
// TipTap surface: notes are for the writer's own eyes, never render to readers
// and never export, so formatting would be ceremony without a payoff.
export default function NotesPanel({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Continuity reminders, threads to fix, questions to answer…"
        spellCheck
        aria-label="Chapter notes"
        className="flex-1 w-full resize-none bg-transparent outline-none text-sm leading-relaxed text-ink placeholder:text-ink-faint"
      />
    </div>
  )
}
