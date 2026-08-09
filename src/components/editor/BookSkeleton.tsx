import OutlineBoardSkeleton from './OutlineBoardSkeleton'

// Used both by the book detail page while its own data is loading and by the
// author layout while the series fetch hasn't returned yet.
//
// KEEP THE WIDTH IN STEP WITH THE PAGE. It is max-w-[1600px] since the outline
// board arrived (LOOM-96); left at the old max-w-3xl, this drew a 768px column
// that snapped to full width the moment data landed — a bigger jump than no
// skeleton at all.
//
// Matches the page's h-full flex flex-col shape too (LOOM-141): the real page
// fills the viewport below the header and scrolls its tab content internally
// rather than the whole page, and a skeleton that doesn't claim the same
// height/flex shape settles shorter, so the swap to real content jumps the
// page's own scroll position — the same reasoning SeriesPageSkeleton documents.
export default function BookSkeleton() {
  return (
    <div className="max-w-[1600px] mx-auto px-8 pt-4 pb-4 h-full flex flex-col animate-pulse">
      <div className="flex-shrink-0 flex gap-4 mb-4">
        {/* surface-raised, matching the real cover well — it was surface-muted,
            a tier lighter than anything on the loaded page. Fixed at 220x320
            (w-[220px] h-[320px]), the same size the real cover now renders at
            (shrunk a third from the original 264x384, then grown a quarter
            back, LOOM-141). */}
        <div className="w-[220px] h-[320px] rounded-lg border-2 border-dashed border-accent/20 bg-surface-raised shrink-0" />

        {/* Title (+ actions) / Synopsis, stacked to the cover's height — same
            shape as the real column. No stats stub: the grid moved behind
            the chart icon below, so it costs no space here either. */}
        <div className="flex-1 h-[320px] flex flex-col gap-3">
          {/* Title + Stats/☰ actions, one row. Preview/Save/Backup/Settings/
              Delete now live behind the ☰ menu (matching the chapter page's
              collapse), so the title claims the width they used to take —
              just two icon buttons remain beside it, both ~34 (h-[30px]
              w-[34px]). */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 h-12 bg-surface-raised border border-accent/20 rounded-lg" />
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-[30px] w-[34px] bg-surface-overlay rounded" />
              <div className="h-[30px] w-[34px] bg-surface-overlay rounded" />
            </div>
          </div>
          <div className="w-full flex-1 min-h-0 bg-surface-raised border border-accent/20 rounded-lg" />
        </div>
      </div>

      {/* Section tab strip — Outline / Chapters / Character(s) / Soundtrack /
          Timeline / Explore, plus the active tab's action button.

          KEEP THE LABEL WIDTHS ROUGHLY IN STEP with SectionTabs: they are
          text-sm, uppercase, tracking-widest, separated by a 24px gap. The
          underline under the first sits on the strip's own border, matching the
          active tab.

          ⚠️ This strip has drifted twice already: Timeline landed on the page
          in LOOM-103 and never landed here, then Chapters landed in
          LOOM-120/121 and did the same. All are added now. Sized the same way
          the series skeleton documents — roughly 11px per character plus 8px
          of padding — rather than by eye.

          flex-1 min-h-0 flex flex-col, matching SectionTabs' own fillHeight
          shape on this page (LOOM-141): the strip stays put and the content
          below it claims the rest of the column instead of the block growing
          past the viewport. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-shrink-0 mb-2 flex items-center justify-between border-b border-accent/10">
          <div className="flex items-center gap-6">
            <div className="-mb-px border-b-2 border-accent pb-2">
              <div className="h-4 w-20 rounded bg-surface-muted" />
            </div>
            {/* Chapters (8 chars), same width as Timeline below. */}
            <div className="pb-2">
              <div className="h-4 rounded bg-surface-overlay" style={{ width: 96 }} />
            </div>
            <div className="pb-2">
              <div className="h-4 w-28 rounded bg-surface-overlay" />
            </div>
            <div className="pb-2">
              <div className="h-4 w-24 rounded bg-surface-overlay" />
            </div>
            {/* Timeline (8 chars) and Explore (7 chars). */}
            <div className="pb-2">
              <div className="h-4 rounded bg-surface-overlay" style={{ width: 96 }} />
            </div>
            <div className="pb-2">
              <div className="h-4 rounded bg-surface-overlay" style={{ width: 86 }} />
            </div>
          </div>
          <div className="pb-2">
            <div className="h-7 w-24 rounded bg-accent/30" />
          </div>
        </div>

        {/* The outline board, which is the default tab. A writer whose last
            tab was Characters gets a board-shaped wait and then a grid of
            faces — the alternative is storing the tab twice, in the skeleton
            and in the strip, and having them disagree. flex-1 min-h-0
            overflow-y-auto, matching the real fillHeight scroll container. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <OutlineBoardSkeleton />
        </div>
      </div>
    </div>
  )
}
