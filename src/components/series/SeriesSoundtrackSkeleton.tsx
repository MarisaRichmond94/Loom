// Loading placeholder for the series page's Soundtrack tab — both while the
// tab's own chunk is loading (passed as dynamic()'s `loading`) and while its
// first fetch to /api/series/[seriesId]/soundtracks is in flight. Sized
// against the real rows in SeriesSoundtrackSection: same index column, same
// full-height square art, same title/scrubber/chapter column.
export default function SeriesSoundtrackSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {[0, 1].map(group => (
        <div key={group} className="flex flex-col gap-2">
          <div className="h-3 w-20 rounded bg-surface-overlay" />
          {[0, 1, 2].map(row => (
            <div key={row} className="rounded-lg bg-surface-raised border border-accent/10 overflow-hidden flex h-[104px]">
              <div className="shrink-0 w-7 flex items-center justify-center">
                <div className="w-3 h-3 rounded bg-surface-overlay" />
              </div>
              <div className="shrink-0 h-full aspect-square bg-surface-overlay" />
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
