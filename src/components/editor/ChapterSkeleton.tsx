// Used both by the chapter editor while its own data is loading and by the
// author layout while the series fetch hasn't returned yet. Mirrors the
// real page's flex-column layout (sticky header, sticky footer) so the
// layout doesn't jump when the data lands.
//
// The header block below is a placeholder for the real page's `headerRef`
// wrapper (chapter/[chapterId]/page.tsx) — if that wrapper's structure
// changes, update this block to match (LOOM-49: it had drifted since KAN-30
// folded the old action-button row into the ☰ menu and made the header
// sticky, and nothing had flagged the skeleton to catch up).
export default function ChapterSkeleton() {
  return (
    <div className="px-8 min-h-full flex flex-col animate-pulse">
      {/* Sticky title/date header — mirrors the real page's `headerRef`
          wrapper: title+POV centered, then a date/search/actions row. */}
      <div className="sticky top-0 z-[45] -mx-8 px-8 pt-3 pb-2 bg-surface-base">
        {/* Back to book link */}
        <div className="h-4 w-32 bg-surface-muted rounded mb-4" />
        {/* Title + POV — centered */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-9 w-72 bg-surface-muted rounded mb-3" />
          <div className="h-7 w-48 bg-surface-raised border border-accent/20 rounded-lg" />
        </div>
        {/* Date · chapter find bar · Collapse All · stats toggle · ☰ chapter-actions menu */}
        <div className="flex items-center gap-4">
          <div className="h-9 w-60 bg-surface-raised border border-accent/20 rounded-lg shrink-0" />
          <div className="ml-auto flex items-center gap-4">
            <div className="h-7 w-72 bg-surface-base border border-accent/20 rounded-lg" />
            <div className="h-4 w-20 bg-surface-muted rounded shrink-0" />
            <div className="h-[26px] w-24 bg-surface-raised border border-accent/20 rounded-lg shrink-0" />
            <div className="w-4 h-4 rounded bg-surface-muted shrink-0" />
          </div>
        </div>
      </div>
      <div className="pb-8 flex-1">
        {/* Block placeholders. The real prose is text-justify (TextBlock.tsx),
            so every wrapped line runs edge-to-edge and only a paragraph's
            last line falls short — full-width bars here, not the ragged
            random widths a left-aligned mock would use, so the line rhythm
            doesn't visibly reflow when real text swaps in. Row height
            (h-3 + space-y-3 ≈ 24px) approximates leading-relaxed's ~26px
            so card heights land close, too.
            Tall block list so the skeleton fills the full viewport height
            on larger screens (it's clipped by the main scroll area on small). */}
        <div className="flex flex-col gap-3">
          {[
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-8/12'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-7/12'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-9/12'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-9/12'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-2/3'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-5/6'],
            ['w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-full', 'w-3/4'],
          ].map((widths, i) => (
            <div key={i} className="bg-surface-raised border border-accent/10 border-l-4 border-l-accent/30 rounded-r-lg p-4">
              {/* No reserved gutter column here (the real row keeps one for
                  the hover delete/chevron buttons) — as a static placeholder
                  the card just spans the full row, so its left and right
                  edges land at the same 32px page margin (the root's px-8)
                  on both sides instead of the right edge falling 24px short. */}
              <div className="space-y-3">
                {widths.map((w, j) => (
                  <div key={j} className={`h-3 ${w} bg-surface-muted rounded`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer placeholder — three slots match the prev / scroll / next
          layout the real page renders. .chrome-dark keeps the bar dark inside
          light mode; it previously hardcoded the dark hexes inline, which
          pinned it to the old palette regardless of the flag (KAN-17). */}
      <div className="chrome-dark sticky bottom-0 z-20 -mx-8 px-8 py-4 bg-surface-raised border-t border-accent/10 flex items-center justify-between gap-4">
        <div className="h-4 w-24 bg-surface-muted rounded" />
        <div className="h-4 w-32 bg-surface-muted rounded" />
        <div className="h-4 w-24 bg-surface-muted rounded" />
      </div>
    </div>
  )
}
