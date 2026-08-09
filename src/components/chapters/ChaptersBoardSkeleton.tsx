// Placeholder board for the Chapters tab (LOOM-120/121).
//
// Same contract as OutlineBoardSkeleton, and the same reason: the geometry
// lives HERE and the real board imports it, so the card's height can only ever
// be changed in one place. A skeleton that guesses is worse than none — the tab
// settles and then jumps when the guess turns out wrong, which is the very
// thing a skeleton is for.
//
// It also draws the FILTER BAR, not just the cards. The bar is two fields tall
// and sits above the board; a skeleton that omits it lets the whole board slide
// down the moment the real one appears.

/** The real card height. Imported by ChaptersSection — do not duplicate. */
export const CHAPTER_CARD_H = 208
export const CHAPTER_GRID_GAP = 12

/** One filter field: its label, then the control. */
function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <div className="h-3 w-16 rounded bg-surface-overlay" />
      <div className="h-9 w-52 rounded-lg border-2 border-accent/10 bg-surface-overlay/40" />
    </div>
  )
}

export default function ChaptersBoardSkeleton({ cards = 15 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Sticky, matching the real filter bar — the tab's own scroll
          container is what this stays pinned to. No pb — see the real
          component for why stacking it with the parent's gap-3 is wrong. */}
      <div className="sticky top-0 z-10 bg-surface-base flex flex-wrap items-end gap-3 pb-1">
        <FieldSkeleton />
        <FieldSkeleton />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: CHAPTER_GRID_GAP,
          alignItems: 'start',
        }}
      >
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            style={{ height: CHAPTER_CARD_H }}
            // border-2, matching the real card — the board is drawn at the
            // active card's thickness so nothing shifts by a pixel when the
            // real one arrives.
            className="flex flex-col gap-2 rounded-lg border-2 border-accent/10 bg-surface-raised px-3.5 py-3"
          >
            {/* Title */}
            <div className="h-3.5 w-24 rounded bg-surface-muted" />
            {/* Date / POV row */}
            <div className="h-2.5 w-16 rounded bg-surface-overlay/60" />
            {/* Summary — the card's body, which is most of its height */}
            <div className="mt-1 flex flex-1 flex-col gap-1.5">
              <div className="h-2 w-full rounded bg-surface-overlay" />
              <div className="h-2 w-11/12 rounded bg-surface-overlay" />
              <div className="h-2 w-full rounded bg-surface-overlay" />
              <div className="h-2 w-4/6 rounded bg-surface-overlay" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
