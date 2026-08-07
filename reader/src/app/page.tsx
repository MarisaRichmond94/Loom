import SeriesLanding, { type LandingBook, type ResumeTarget } from '@/components/SeriesLanding'
import { continueReading, resumeFor } from '@/lib/progress'
import { hasContent, query } from '@/lib/db'
import { requireReader } from '@/lib/readers'

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

export default async function Home() {
  // Gated: no cookie, unknown token, or revoked reader → /invite (LOOM-132).
  const reader = await requireReader()

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

  // Where the primary button goes (LOOM-133). Resolved through the ladder, so
  // a saved position pointing at a since-unpublished chapter lands somewhere
  // real instead of 404-ing. Falls back to the first published book for a
  // reader who has not started anything.
  const cards = continueReading(reader.id)
  const firstBook = landingBooks.find(b => b.published)
  const mostRecent = cards[0]

  const resume: ResumeTarget = mostRecent
    ? {
        href: `/book/${mostRecent.bookId}/chapter/${mostRecent.chapterId}?resume=1${mostRecent.notice ? '&moved=previous' : ''}`,
        label: 'Continue reading',
      }
    : firstBook
      ? (() => {
          const point = resumeFor(reader.id, firstBook.id)
          return point
            ? { href: `/book/${firstBook.id}/chapter/${point.chapterId}`, label: 'Start reading' }
            : null
        })()
      : null

  return (
    <SeriesLanding
      resume={resume}
      continueReading={cards.map(c => ({
        bookId: c.bookId,
        title: c.title,
        coverPath: c.coverPath,
        chapterId: c.chapterId,
        chapterLabel: c.chapterLabel,
        chapterNumbered: c.chapterNumbered,
        offset: c.offset,
        notice: c.notice,
        updatedAt: c.updatedAt,
      }))}
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
