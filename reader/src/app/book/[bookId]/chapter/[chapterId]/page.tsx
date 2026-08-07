import { notFound } from 'next/navigation'
import ChapterView, { type ChapterNav, type ProseBlock } from '@/components/ChapterView'
import { hasContent, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

type ChapterRow = {
  id: string; bookId: string; title: string; label: string
  numbered: number; order: number; pov: string | null; date: string | null
}

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ bookId: string; chapterId: string }>
}) {
  const { bookId, chapterId } = await params
  if (!hasContent()) notFound()

  // Joined to Book so an unpublished book's chapter cannot be reached by
  // guessing an id — a draft has no chapters in the snapshot at all, but the
  // join makes that independent of how the rows were written.
  const chapter = query<ChapterRow>(
    `SELECT c.id, c.bookId, c.title, c.label, c.numbered, c."order", c.pov, c.date
       FROM Chapter c JOIN Book b ON b.id = c.bookId
      WHERE c.id = ? AND c.bookId = ? AND b.published = 1`,
    chapterId, bookId,
  )[0]
  if (!chapter) notFound()

  const book = query<{ title: string }>(`SELECT title FROM Book WHERE id = ?`, bookId)[0]

  const blocks = query<{ id: string; type: string; content: string; title: string | null }>(
    `SELECT id, type, content, title FROM ContentBlock WHERE chapterId = ? ORDER BY "order"`,
    chapterId,
  ) as ProseBlock[]

  // Neighbours by canon position, not Chapter.order — the walk's order is what
  // the reader experiences.
  const neighbour = (dir: 'prev' | 'next'): ChapterNav => {
    const row = query<{ id: string; label: string; numbered: number }>(
      dir === 'prev'
        ? `SELECT id, label, numbered FROM Chapter WHERE bookId = ? AND "order" < ? ORDER BY "order" DESC LIMIT 1`
        : `SELECT id, label, numbered FROM Chapter WHERE bookId = ? AND "order" > ? ORDER BY "order" ASC LIMIT 1`,
      bookId, chapter.order,
    )[0]
    // `!!` — SQLite has no boolean type; `numbered` arrives as 0/1.
    return row ? { id: row.id, label: row.label, numbered: !!row.numbered } : null
  }

  const narration = query<{ audioPath: string; durationMs: number }>(
    `SELECT audioPath, durationMs FROM Narration WHERE chapterId = ?`, chapterId,
  )[0] ?? null

  return (
    <ChapterView
      narration={narration}
      bookId={bookId}
      bookTitle={book?.title ?? ''}
      heading={chapter.numbered ? `Chapter ${chapter.label}` : chapter.label}
      pov={chapter.pov}
      date={chapter.date}
      blocks={blocks}
      prev={neighbour('prev')}
      next={neighbour('next')}
    />
  )
}
