// Used both by the book detail page while its own data is loading and by the
// author layout while the series fetch hasn't returned yet.
export default function BookSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-8 animate-pulse">
      {/* Cover + title/synopsis row */}
      <div className="flex gap-8 mb-8 items-stretch">
        <div className="w-44 rounded-lg border-2 border-dashed border-accent/20 bg-surface-muted self-stretch" style={{ minHeight: '264px' }} />
        <div className="flex-1 flex flex-col gap-4">
          <div className="w-full h-12 bg-surface-raised border border-accent/20 rounded-lg" />
          <div className="w-full flex-1 bg-surface-raised border border-accent/20 rounded-lg" style={{ minHeight: '200px' }} />
        </div>
      </div>
      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-surface-raised border border-accent/10 rounded-lg px-4 py-5 flex flex-col items-center gap-1">
            <div className="h-8 w-10 bg-surface-muted rounded" />
            <div className="h-3 w-16 bg-surface-muted rounded" />
          </div>
        ))}
      </div>
      {/* Characters section header + placeholder grid */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-32 bg-surface-muted rounded" />
          <div className="h-7 w-32 bg-accent/30 rounded" />
        </div>
        <div className="rounded-xl border-2 border-dashed border-accent/20" style={{ height: 300 }} />
      </div>
    </div>
  )
}
