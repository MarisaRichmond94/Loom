// Placeholder cards for the outline board (LOOM-97).
//
// Shared by the book page's skeleton and by the Outline tab's own loading
// state, so the shape the writer sees while waiting is the same in both — and
// so a change to the card's height only has to be made once.
//
// The height is the card's REAL height. A skeleton that guesses is worse than
// none: the page settles, then jumps when the guess turns out wrong, which is
// the exact thing BookSkeleton exists to prevent (and has already drifted from
// once — see the note in that file).

export const OUTLINE_CARD_H = 250

export default function OutlineBoardSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}
    >
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          style={{ height: OUTLINE_CARD_H }}
          className="flex flex-col gap-2 rounded-lg border border-accent/10 bg-surface-raised px-4 py-3"
        >
          {/* Status chip */}
          <div className="h-4 w-16 rounded-full bg-surface-overlay" />
          {/* Label + POV chip */}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-4 w-20 rounded bg-surface-muted" />
            <div className="h-4 w-16 rounded-full bg-surface-overlay" />
          </div>
          {/* Date */}
          <div className="h-3 w-28 rounded bg-surface-overlay" />
          {/* Summary field — the page background, matching the real editor */}
          <div className="mt-1 flex-1 rounded border border-accent/10 bg-surface-base/60" />
        </div>
      ))}
    </div>
  )
}
