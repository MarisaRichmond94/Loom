// Loading placeholder for the series page's Soundtrack tab — both while the
// tab's own chunk is loading (passed as dynamic()'s `loading`) and while its
// first fetch to /api/series/[seriesId]/soundtracks is in flight. Sized
// against the real rows in SeriesSoundtrackSection: same index column, same
// full-height square art, same title/scrubber/chapter column.
export default function SeriesSoundtrackSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      {/* Matches SoundtrackPlayerBar's shape: 5 transport icons, an art
          square, a title/artist column, and a progress bar. */}
      <div className="flex items-center gap-3 rounded-lg border border-accent/10 bg-surface-raised px-3 py-2">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className={`shrink-0 rounded-full bg-surface-overlay ${i === 2 ? 'w-8 h-8' : 'w-7 h-7'}`} />
        ))}
        <div className="shrink-0 w-9 h-9 rounded bg-surface-overlay" />
        <div className="min-w-0 shrink-0 max-w-[35%] flex flex-col gap-1.5">
          <div className="h-3.5 w-24 rounded bg-surface-overlay" />
          <div className="h-3 w-16 rounded bg-surface-overlay" />
        </div>
        <div className="flex-1 h-1.5 rounded-full bg-surface-overlay" />
      </div>
      {[0, 1].map(group => (
        <div key={group} className="flex flex-col gap-2">
          <div className="h-3 w-20 rounded bg-surface-overlay" />
          {[0, 1, 2].map(row => (
            <div key={row} className="rounded-lg bg-surface-raised border border-accent/10 overflow-hidden flex h-[104px]">
              <div className="shrink-0 w-7 flex items-center justify-center">
                <div className="w-3 h-3 rounded bg-surface-overlay" />
              </div>
              <div className="shrink-0 flex h-full items-center justify-center">
                <div className="h-[calc(100%-1.5rem)] aspect-square rounded bg-surface-overlay" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-2 px-4 py-3">
                <div className="h-4 w-1/2 rounded bg-surface-overlay" />
                <div className="h-8 w-full rounded bg-surface-overlay" />
                <div className="h-3 w-1/4 rounded bg-surface-overlay" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
