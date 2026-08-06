import SeriesLanding, { type LandingBook } from '@/components/SeriesLanding'
import { hasContent, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type SeriesRow = {
  title: string; description: string; authorName: string
  genres: string; keywords: string
}
type BookRow = {
  id: string; title: string; synopsis: string
  coverPath: string | null; order: number; published: number
}

/** genres/keywords are JSON strings — SQLite has no list type. */
const parseList = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export default function Home() {
  // Nothing published is a normal state, not an error: the reader app can be
  // running before the author has ever pressed Publish.
  if (!hasContent()) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-20">
        <p className="text-ink-muted text-sm">Nothing has been published yet.</p>
      </main>
    )
  }

  const s = query<SeriesRow>(
    `SELECT title, description, authorName, genres, keywords FROM Series`,
  )[0]
  const books = query<BookRow>(
    `SELECT id, title, synopsis, coverPath, "order", published FROM Book ORDER BY "order"`,
  )

  const landingBooks: LandingBook[] = books.map(b => ({
    id: b.id,
    title: b.title,
    synopsis: b.synopsis,
    coverPath: b.coverPath,
    order: b.order,
    // `!!` is load-bearing: SQLite has no boolean type, so this arrives as 0/1
    // and `0 && …` renders a literal "0".
    published: !!b.published,
  }))

  return (
    <SeriesLanding
      series={{
        title: s?.title ?? '',
        description: s?.description ?? '',
        authorName: s?.authorName ?? '',
        genres: parseList(s?.genres ?? null),
        keywords: parseList(s?.keywords ?? null),
      }}
      books={landingBooks}
    />
  )
}
