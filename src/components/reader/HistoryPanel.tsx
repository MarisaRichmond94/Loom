'use client'

type HistoryEntry = { choicePointId: string; choiceId: string; stateSnapshot: Record<string, unknown> }

type Props = {
  history: HistoryEntry[]
  choiceLabels: Record<string, string>
  choicePointLocations: Record<string, string>
  currentlyChoosing: boolean
  onRewind: (choicePointId: string) => void
  onClose: () => void
}

export default function HistoryPanel({
  history, choiceLabels, choicePointLocations, currentlyChoosing, onRewind, onClose
}: Props) {
  return (
    <div className="fixed right-0 top-0 bottom-0 w-72 bg-surface-raised border-l border-accent/10 z-40 flex flex-col shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-accent/10">
        <span className="text-sm text-accent">⏮ Your Choices</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">tap to rewind</span>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg leading-none">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {history.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-4">No choices made yet.</p>
        )}
        {history.map((entry, i) => (
          <button
            key={`${entry.choicePointId}-${i}`}
            onClick={() => onRewind(entry.choicePointId)}
            className="text-left bg-choice-spare-bg border border-choice-spare-border rounded p-3 hover:opacity-80 transition"
          >
            <div className="text-xs text-ink-faint mb-1">{choicePointLocations[entry.choicePointId] ?? 'Scene'}</div>
            <div className="text-sm text-choice-spare">{choiceLabels[entry.choiceId] ?? entry.choiceId}</div>
          </button>
        ))}
        {currentlyChoosing && (
          <div className="border border-dashed border-accent/20 rounded p-3 opacity-50">
            <div className="text-xs text-ink-faint mb-1">Now</div>
            <div className="text-sm text-accent italic">Choosing…</div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-accent/10">
        <p className="text-xs text-ink-faint leading-relaxed">
          Tap any past choice to rewind to that moment. Everything after is erased and you choose again from there.
        </p>
      </div>
    </div>
  )
}
