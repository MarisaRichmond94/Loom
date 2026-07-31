// Body skeleton for the /author/[seriesId] (books list) route. Used by the
// author layout when series hasn't returned and the page hasn't mounted yet.
// Mirrors the real layout: the Backup/Preview action row, centered title, then
// Description / Genres / Keywords / books list — so the layout doesn't
// jump when the data lands.
export default function SeriesPageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-8 animate-pulse">
      {/* Action row — Backup then Preview (KAN-19; renamed from Export in
          KAN-20). Was a single absolutely positioned Preview stub; the real
          page now uses a flex row, and the skeleton has to match or the title
          shifts down when data lands.

          Widths still hold after the rename: same two controls, and "Backup"
          is the same length as "Export". Re-check if a third one lands here —
          BookSkeleton drifted exactly that way and went unnoticed. */}
      <div className="flex justify-end items-center gap-2 mb-2">
        <div className="h-7 w-20 bg-surface-overlay rounded" />
        <div className="h-7 w-24 bg-accent/30 rounded" />
      </div>

      {/* Title + by-author */}
      <div className="flex flex-col items-center mb-8">
        <div className="h-9 w-72 bg-surface-muted rounded mb-2" />
        <div className="h-3 w-24 bg-surface-muted rounded" />
      </div>

      {/* Description / Genres / Keywords block */}
      <div className="mb-8 flex flex-col gap-6">
        <div>
          <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
          <div className="h-20 bg-surface-overlay rounded-lg" />
        </div>
        <div>
          <div className="h-3 w-16 bg-surface-muted rounded mb-2" />
          {/* Genre chips. Genre is a MULTI-SELECT against the fixed list in
              @/lib/genres, so the real row always renders ALL of them —
              currently 16 — not just the ones selected. The skeleton drew 12
              uniform-ish stubs, so the cloud re-wrapped when data landed.
              Widths below are per-label (text-xs, px-2.5), longest "Contemporary"
              and "Young Adult", shortest "CYOA". Re-derive if genres.ts changes. */}
          <div className="flex flex-wrap gap-1.5">
            {[76, 57, 94, 51, 45, 51, 76, 63, 82, 57, 63, 82, 63, 57, 70, 88].map((w, i) => (
              <div key={i} className="h-6 bg-surface-muted rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>
        <div>
          <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
          {/* Keyword chips + the trailing input. Unlike genres these are
              free-form, so the count is per-series; sized for the primary
              user's two ("Psychological Thriller", "Dark") on the same basis
              as the five book stubs below. Each carries a remove "×", hence
              the extra ~14px over a plain chip.

              The input is flex-1 min-w-[140px] in the real editor — it GROWS
              to fill the row. A fixed w-36 stub left a gap that closed on
              load, so it matches those constraints instead. */}
          <div className="flex flex-wrap gap-1.5">
            <div className="h-6 w-44 bg-surface-muted rounded-full" />
            <div className="h-6 w-16 bg-surface-muted rounded-full" />
            <div className="h-6 flex-1 min-w-[140px] bg-surface-overlay border border-dashed border-accent/20 rounded-full" />
          </div>
        </div>
      </div>

      {/* Books — five stubs because that matches the primary user's series. */}
      <div className="flex flex-col gap-4">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20">
            <div className="w-28 shrink-0 rounded bg-surface-muted" style={{ minHeight: '9rem' }} />
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex items-baseline gap-3 mb-4">
                  <div className="h-3 w-12 bg-surface-muted rounded" />
                  <div className="h-5 w-48 bg-surface-muted rounded" />
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
              {/* THREE controls, not two: "Mark as in progress" (or the
                  shorter "In progress" once set), Backup, and Delete. The
                  skeleton drew two narrow stubs — about 152px against a real
                  row nearer 300px — so every card's control row jumped
                  rightward on load. Sized for the longer "Mark as in progress",
                  which is the state most books are in. */}
              <div className="flex justify-end gap-2 mt-3">
                <div className="h-7 w-40 bg-surface-overlay rounded" />
                <div className="h-7 w-20 bg-surface-overlay rounded" />
                <div className="h-7 w-16 bg-surface-overlay rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
