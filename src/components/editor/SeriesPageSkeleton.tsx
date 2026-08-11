// Body skeleton for the /author/[seriesId] route. Used by the author layout
// when series hasn't returned and the page hasn't mounted yet.
//
// Rewritten for the tabbed, full-width layout (LOOM-106, with LOOM-105).
//
// ⚠️ This file has drifted twice before, and both times it was invisible until
// someone watched the page load: the genre row drew 12 uniform stubs against a
// real row of ALL 16 genres, so the cloud re-wrapped; and the book-card control
// row drew ~152px against a real row nearer 300px, so every card's controls
// jumped rightward. The lesson both times was the same — size against the REAL
// markup, per element, not by eye.
export default function SeriesPageSkeleton() {
  return (
    // Matches the page's max-w-[1600px] and h-full flex flex-col: the real
    // page fills the viewport below the header and scrolls its tab content
    // internally rather than the whole page, and a skeleton that doesn't
    // claim the same height/flex shape settles shorter, so the swap to real
    // content jumps the page's own scroll position.
    <div className="max-w-[1600px] mx-auto px-8 pt-4 pb-4 h-full flex flex-col animate-pulse">
      {/* Title + action row, in one line (buttons right of the title, not a
          row of their own above it). Grid, matching the real markup, so the
          title column's width — and therefore where the by-line centres —
          doesn't shift when the real controls replace these stubs. */}
      <div className="flex-shrink-0 grid grid-cols-[1fr_auto] items-start gap-4 mb-3">
        <div className="flex flex-col items-center">
          <div className="h-9 w-72 bg-surface-muted rounded mb-2" />
          <div className="h-3 w-24 bg-surface-muted rounded" />
        </div>
        {/* Series actions ☰ (LOOM-142) — replaces the old standalone
            Backup/Preview buttons, which now live inside this menu along with
            Configure. Same icon-button stub shape as the book page's own
            action-menu trigger. */}
        <div className="flex items-center gap-2 pt-1">
          <div className="h-[30px] w-[34px] bg-surface-overlay rounded" />
        </div>
      </div>

      {/* Description block. Genre(s)/Keyword(s) moved into the Configure
          modal (LOOM-142) and are no longer drawn on the page — the box below
          grew from rows=2 to a fixed h-32 to take their old space. */}
      <div className="flex-shrink-0 mb-3 flex flex-col">
        <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
        <div className="h-32 bg-surface-overlay rounded-lg" />
      </div>

      {/* Tab strip — Book(s) / Character(s) / Timeline / Explore / Path(s)
          (LOOM-105, Explore added by LOOM-118, Path(s) added by LOOM-122).
          Sized per label at text-sm uppercase tracking-widest with px-1, the
          same per-element discipline as the genre row: ~11px per character
          including tracking, plus 8px of padding. Height comes from pb-2 over a
          20px line box, and the bottom border is the strip's own — both
          matching SectionTabs, so the content below starts at the right y.

          "Explore" and "Path(s)" are both 7 characters, the same as "Book(s)",
          hence the repeated 86. Adding a tab and not adding a stub here is the
          exact drift this file has already suffered — the strip would settle
          one tab narrower and everything after it would shift sideways on
          hydration.

          flex-1 min-h-0 flex flex-col, matching SectionTabs' own fillHeight
          shape on this page: the strip stays put and the content below it
          claims the rest of the column instead of the block growing past the
          viewport and pushing the page into its own scroll. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-shrink-0 flex items-center justify-between mb-2 border-b border-accent/10">
          <div className="flex items-center gap-6">
            {[86, 142, 98, 86, 86].map((w, i) => (
              <div key={i} className="pb-2">
                <div className="h-5 bg-surface-muted rounded" style={{ width: w }} />
              </div>
            ))}
          </div>
          {/* No action stub. Books is the default tab and carries no header
              control; Character(s) has none either; and Timeline's "Add Event"
              only exists once that tab is chosen, which is never on first
              paint. Drawing one here would be a button that vanishes on load. */}
        </div>

        {/* Books-tab content only — the skeleton renders what the DEFAULT tab
            renders. Drawing a timeline or a character grid under a strip that
            will resolve to Books would be a worse jump than drawing nothing.
            Five stubs, matching the primary user's series. flex-1 min-h-0
            overflow-y-auto, matching the real scroll container so the stubs
            below the fold sit exactly where the real cards will. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20">
                <div className="w-28 shrink-0 rounded bg-surface-muted" style={{ minHeight: '9rem' }} />
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    {/* items-CENTER, matching the real row: the status chip is a
                        control, and baseline alignment sat it visibly low. */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-3 w-12 bg-surface-muted rounded" />
                      <div className="h-5 w-48 bg-surface-muted rounded" />
                      {/* The status chip (LOOM-140). Without a stub the title row
                          reflows when it arrives. */}
                      <div className="h-4 w-20 bg-surface-overlay rounded" />
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {[0, 1, 2, 3].map(j => (
                        <div key={j} className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-4 flex flex-col items-center gap-1">
                          <div className="h-6 w-8 bg-surface-muted rounded" />
                          <div className="h-3 w-14 bg-surface-muted rounded" />
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* THREE controls: the publish button (accent, because it is
                      the primary action and should read as one while loading),
                      Backup and Delete. Status is NOT here — it is the chip
                      beside the title (LOOM-140). This previously described
                      "Mark as in progress", a button that no longer exists. */}
                  <div className="flex justify-end gap-2 mt-3">
                    <div className="h-7 w-32 bg-accent/30 rounded" />
                    <div className="h-7 w-20 bg-surface-overlay rounded" />
                    <div className="h-7 w-16 bg-surface-overlay rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
