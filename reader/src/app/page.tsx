import { hasContent, query } from '@/lib/db'

// Placeholder catalog (LOOM-130). The real reading surfaces are LOOM-131 —
// this exists to prove the app boots, resolves the shared theme, and can read
// the published snapshot without any access to the manuscript.

type SeriesRow = { title: string; description: string; authorName: string }
type BookRow = { id: string; title: string; synopsis: string; order: number; published: number }

export const dynamic = 'force-dynamic'

export default function Home() {
  // Nothing published yet is a normal state, not an error — the reader app can
  // be running before the author has ever pressed Publish.
  if (!hasContent()) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-20">
        <p className="text-ink-muted text-sm">Nothing has been published yet.</p>
      </main>
    )
  }

  const series = query<SeriesRow>(`SELECT title, description, authorName FROM Series`)[0]
  const books = query<BookRow>(`SELECT id, title, synopsis, "order", published FROM Book ORDER BY "order"`)

  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold text-ink">{series?.title}</h1>
      {series?.authorName && (
        <p className="text-sm text-ink-muted mt-1">by {series.authorName}</p>
      )}
      {series?.description && (
        <p className="text-sm text-ink-muted mt-4 leading-relaxed">{series.description}</p>
      )}

      <div className="mt-10 flex flex-col gap-3">
        {books.map(b => (
          <div
            key={b.id}
            className="p-4 rounded-lg bg-surface-raised border border-accent/10"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">
                Book {b.order}
              </span>
              <span className={`font-medium ${b.published ? 'text-ink' : 'text-ink-muted'}`}>
                {b.title}
              </span>
              {/* A book that has not been published to readers is a stub here:
                  title and position only. There is no synopsis, cover or
                  chapter to leak, because publish never wrote one. */}
              {!b.published && (
                <span className="ml-auto text-[10px] uppercase tracking-widest text-ink-faint border border-accent/20 rounded px-1.5 py-0.5">
                  Coming soon
                </span>
              )}
            </div>
            {/* `!!` is load-bearing. SQLite has no boolean type, so `published`
                arrives as 0 or 1 — and `0 && …` evaluates to 0, which React
                renders as a literal "0" under every unpublished book. The same
                trap is waiting on every other flag read out of content.db. */}
            {!!b.published && !!b.synopsis && (
              <p className="text-sm text-ink-muted mt-2 leading-relaxed">{b.synopsis}</p>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}
