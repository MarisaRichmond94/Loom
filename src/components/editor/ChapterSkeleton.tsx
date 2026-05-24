// Used both by the chapter editor while its own data is loading and by the
// author layout while the series fetch hasn't returned yet.
export default function ChapterSkeleton() {
  return (
    <div className="px-8 animate-pulse">
      {/* Mirrors the real action row so the layout doesn't jump on load. */}
      <div className="sticky top-0 z-10 flex justify-end items-center gap-2 py-3 pr-6">
        <div className="w-5 h-5 rounded bg-surface-muted" />
        <div className="h-7 w-16 rounded bg-surface-muted" />
        <div className="h-7 w-20 rounded bg-accent/30" />
      </div>
      <div className="pb-8">
        {/* Title + POV — centered */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-9 w-72 bg-surface-muted rounded mb-3" />
          <div className="h-7 w-48 bg-surface-raised border border-accent/20 rounded-lg" />
        </div>
        {/* Date */}
        <div className="h-9 w-44 bg-surface-raised border border-accent/20 rounded-lg mb-2" />
        {/* Block placeholders — varied widths to feel less mechanical. */}
        <div className="flex flex-col gap-3">
          {[
            ['w-11/12', 'w-full', 'w-10/12', 'w-9/12'],
            ['w-full', 'w-5/6', 'w-11/12', 'w-2/3'],
            ['w-10/12', 'w-full', 'w-3/4'],
          ].map((widths, i) => (
            <div key={i} className="flex items-start">
              <div className="flex-1 min-w-0 bg-surface-raised border border-accent/10 border-l-4 border-l-accent/30 rounded-r-lg p-4">
                <div className="pl-4 space-y-2">
                  {widths.map((w, j) => (
                    <div key={j} className={`h-3 ${w} bg-surface-muted rounded`} />
                  ))}
                </div>
              </div>
              {/* Reserves the same 24px column the real block row keeps for the
                  hover-delete X so the card right edge aligns with the action row. */}
              <div className="shrink-0" style={{ width: '24px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
