// Used both by the chapter editor while its own data is loading and by the
// author layout while the series fetch hasn't returned yet. Mirrors the
// real page's flex-column layout (and sticky footer) so the layout
// doesn't jump when the data lands.
export default function ChapterSkeleton() {
  return (
    <div className="px-8 min-h-full flex flex-col animate-pulse">
      {/* Mirrors the real action row: settings cog · copy · review · preview */}
      <div className="flex justify-end items-center gap-2 py-3 pr-6">
        <div className="w-5 h-5 rounded bg-surface-muted" />
        <div className="h-7 w-[76px] rounded bg-surface-muted" />
        <div className="h-7 w-[85px] rounded bg-accent/20" />
        <div className="h-7 w-[88px] rounded bg-accent/30" />
      </div>
      <div className="pb-8 flex-1">
        {/* Title + POV — centered */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-9 w-72 bg-surface-muted rounded mb-3" />
          <div className="h-7 w-48 bg-surface-raised border border-accent/20 rounded-lg" />
        </div>
        {/* Date */}
        <div className="h-9 w-60 bg-surface-raised border border-accent/20 rounded-lg mb-2" />
        {/* Block placeholders — varied widths to feel less mechanical.
            Tall block list so the skeleton fills the full viewport height
            on larger screens (it's clipped by the main scroll area on small). */}
        <div className="flex flex-col gap-3">
          {[
            ['w-11/12', 'w-full', 'w-10/12', 'w-9/12', 'w-full', 'w-8/12'],
            ['w-full', 'w-5/6', 'w-11/12', 'w-2/3', 'w-10/12', 'w-full', 'w-7/12'],
            ['w-10/12', 'w-full', 'w-3/4', 'w-11/12', 'w-9/12'],
            ['w-full', 'w-10/12', 'w-11/12', 'w-2/3', 'w-full', 'w-8/12', 'w-9/12'],
            ['w-9/12', 'w-full', 'w-11/12', 'w-10/12', 'w-2/3'],
            ['w-full', 'w-3/4', 'w-10/12', 'w-9/12', 'w-full', 'w-5/6'],
            ['w-10/12', 'w-11/12', 'w-full', 'w-2/3', 'w-9/12', 'w-full', 'w-3/4'],
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

      {/* Footer placeholder — three slots match the prev / scroll / next
          layout the real page renders. Forces the dark theme via the same
          CSS-variable overrides so the bar stays dark in light mode. */}
      <div
        style={{
          '--color-surface-raised': '#12121e',
          '--color-surface-muted': '#1e1e3a',
        } as React.CSSProperties}
        className="sticky bottom-0 z-20 -mx-8 px-8 py-4 bg-surface-raised border-t border-accent/10 flex items-center justify-between gap-4"
      >
        <div className="h-4 w-24 bg-surface-muted rounded" />
        <div className="h-4 w-32 bg-surface-muted rounded" />
        <div className="h-4 w-24 bg-surface-muted rounded" />
      </div>
    </div>
  )
}
