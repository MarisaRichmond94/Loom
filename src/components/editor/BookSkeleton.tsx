import OutlineBoardSkeleton from './OutlineBoardSkeleton'

// Used both by the book detail page while its own data is loading and by the
// author layout while the series fetch hasn't returned yet.
//
// KEEP THE WIDTH IN STEP WITH THE PAGE. It is max-w-[1600px] since the outline
// board arrived (LOOM-96); left at the old max-w-3xl, this drew a 768px column
// that snapped to full width the moment data landed — a bigger jump than no
// skeleton at all.
export default function BookSkeleton() {
  return (
    <div className="max-w-[1600px] mx-auto px-8 py-8 animate-pulse">
      {/* Action row — Published/Draft, Backup, Save, Preview. This was missing
          entirely, so the cover and everything under it jumped up by the row's
          height plus its margin the moment data landed (KAN-19).

          KEEP THE COUNT AND WIDTHS IN STEP WITH THE REAL ROW in
          author/[seriesId]/book/[bookId]/page.tsx. It has drifted once already:
          KAN-20 added Backup and renamed Download to Save, and this skeleton
          still drew three boxes sized for the old labels — so the row silently
          resized on load, which is the exact jump the skeleton exists to
          prevent. Widths approximate px-3 padding + a 12px icon + the label.

          Preview is last and accent-filled, matching it as the primary action.

          Widths are per-label at text-xs with px-3 padding, a 12px icon and a
          gap-1.5: Published/Draft ~96 (dot, no icon), Backup ~82, Save ~69,
          Preview ~89. The first can only match one of its two labels, so it is
          sized for "Published"; a Draft book shows a small gap there. */}
      <div className="flex items-center justify-end gap-2 mb-6">
        <div className="h-7 w-24 bg-surface-overlay rounded" />
        <div className="h-7 w-20 bg-surface-overlay rounded" />
        <div className="h-7 w-16 bg-surface-overlay rounded" />
        <div className="h-7 w-24 bg-accent/30 rounded" />
      </div>

      {/* Cover + title/synopsis row */}
      <div className="flex gap-8 mb-8 items-stretch">
        {/* surface-raised, matching the real cover well — it was surface-muted,
            a tier lighter than anything on the loaded page. */}
        <div className="w-44 rounded-lg border-2 border-dashed border-accent/20 bg-surface-raised self-stretch" style={{ minHeight: '264px' }} />
        <div className="flex-1 flex flex-col gap-4">
          <div className="w-full h-12 bg-surface-raised border border-accent/20 rounded-lg" />
          <div className="w-full flex-1 bg-surface-raised border border-accent/20 rounded-lg" style={{ minHeight: '200px' }} />
        </div>
      </div>
      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-surface-raised border border-accent/10 rounded-lg px-4 py-5 flex flex-col items-center gap-1">
            <div className="h-8 w-10 bg-surface-muted rounded" />
            <div className="h-3 w-16 bg-surface-muted rounded" />
          </div>
        ))}
      </div>
      {/* Section tab strip — Outline / Character(s) / Soundtrack, plus the
          active tab's action button.

          KEEP THE LABEL WIDTHS ROUGHLY IN STEP with SectionTabs: they are
          text-sm, uppercase, tracking-widest, separated by a 24px gap. The
          underline under the first sits on the strip's own border, matching the
          active tab. */}
      <div className="mb-2 flex items-center justify-between border-b border-accent/10">
        <div className="flex items-center gap-6">
          <div className="-mb-px border-b-2 border-accent pb-2">
            <div className="h-4 w-20 rounded bg-surface-muted" />
          </div>
          <div className="pb-2">
            <div className="h-4 w-28 rounded bg-surface-overlay" />
          </div>
          <div className="pb-2">
            <div className="h-4 w-24 rounded bg-surface-overlay" />
          </div>
        </div>
        <div className="pb-2">
          <div className="h-7 w-24 rounded bg-accent/30" />
        </div>
      </div>

      {/* The outline board, which is the default tab. A writer whose last tab
          was Characters gets a board-shaped wait and then a grid of faces —
          the alternative is storing the tab twice, in the skeleton and in the
          strip, and having them disagree. */}
      <OutlineBoardSkeleton />
    </div>
  )
}
