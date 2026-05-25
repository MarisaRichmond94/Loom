// Body skeleton for the /author/[seriesId] (books list) route. Used by the
// author layout when series hasn't returned and the page hasn't mounted yet.
// Mirrors the real layout: Preview button top-right, centered title, then
// Description / Genres / Keywords / books list — so the layout doesn't
// jump when the data lands.
export default function SeriesPageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-8 relative animate-pulse">
      {/* Preview button (top-right) */}
      <div className="absolute top-8 right-8 h-7 w-24 bg-accent/30 rounded" />

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
          {/* Chip cloud */}
          <div className="flex flex-wrap gap-1.5">
            {[64, 56, 52, 60, 48, 56, 52, 60, 56, 48, 64, 52].map((w, i) => (
              <div key={i} className="h-6 bg-surface-muted rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>
        <div>
          <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
          {/* Keyword chips + the trailing input */}
          <div className="flex flex-wrap gap-1.5">
            <div className="h-6 w-24 bg-surface-muted rounded-full" />
            <div className="h-6 w-16 bg-surface-muted rounded-full" />
            <div className="h-6 w-36 bg-surface-overlay border border-dashed border-accent/20 rounded-full" />
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
              <div className="flex justify-end gap-2 mt-3">
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
