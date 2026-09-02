// Loading placeholder for the series page's Soundtrack tab — both while the
// tab's own chunk is loading (passed as dynamic()'s `loading`) and while its
// first fetch to /api/series/[seriesId]/soundtracks is in flight. Sized
// against the real rows in SeriesSoundtrackSection: same index column, same
// 40px art square, same 40%-wide title block.
export default function SeriesSoundtrackSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      {[0, 1].map(group => (
        <div key={group} className="flex flex-col gap-2">
          <div className="h-3 w-20 rounded bg-surface-overlay" />
          {[0, 1, 2].map(row => (
            <div key={row} className="px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
              <div className="flex items-center gap-3">
                <div className="shrink-0 w-6 h-3 rounded bg-surface-overlay" />
                <div className="shrink-0 w-10 h-10 rounded bg-surface-overlay" />
                <div className="shrink-0 w-[40%] pr-3 flex flex-col gap-2">
                  <div className="h-4 w-3/4 rounded bg-surface-overlay" />
                  <div className="h-3 w-1/2 rounded bg-surface-overlay" />
                </div>
                <div className="flex-1 h-8 rounded bg-surface-overlay" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
