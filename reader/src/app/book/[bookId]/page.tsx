import { notFound } from 'next/navigation'
import BookLanding, { type BookChapter, type BookCharacter, type BookTrack } from '@/components/BookLanding'
import { hasContent, query } from '@/lib/db'
import { requireReader } from '@/lib/readers'

export const dynamic = 'force-dynamic'

type BookRow = {
  title: string; synopsis: string; coverPath: string | null
  order: number; published: number
}
type ChapterRow = {
  id: string; title: string; label: string; numbered: number; narrated: number
}

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  await requireReader()
  const { bookId } = await params
  if (!hasContent()) notFound()

  const book = query<BookRow>(
    `SELECT title, synopsis, coverPath, "order", published FROM Book WHERE id = ?`,
    bookId,
  )[0]

  // An unpublished book has no page. It exists in the snapshot only as a
  // "Coming Soon" stub — no chapters, no synopsis — so there is nothing to
  // show and guessing the URL must not reveal that there could be.
  if (!book || !book.published) notFound()

  const seriesTitle = query<{ title: string }>(`SELECT title FROM Series`)[0]?.title ?? ''

  const chapters = query<ChapterRow>(
    `SELECT c.id, c.title, c.label, c.numbered,
            (SELECT COUNT(*) FROM Narration n WHERE n.chapterId = c.id) AS narrated
       FROM Chapter c WHERE c.bookId = ? ORDER BY c."order"`,
    bookId,
  )

  const list: BookChapter[] = chapters.map(c => ({
    id: c.id,
    title: c.title,
    label: c.label,
    // `!!` — SQLite has no boolean type; these arrive as 0/1.
    numbered: !!c.numbered,
    narrated: !!c.narrated,
  }))

  const characters = query<{ id: string; name: string; age: number | null; photoPath: string | null; deceased: number }>(
    `SELECT id, name, age, photoPath, deceased FROM Character WHERE bookId = ? ORDER BY name`,
    bookId,
  ).map((c): BookCharacter => ({
    id: c.id, name: c.name, age: c.age, photoPath: c.photoPath, deceased: !!c.deceased,
  }))

  // Soundtrack blocks, in reading order, with the chapter they sit in. Album
  // art is a naming convention beside the track, not a column.
  const tracks = query<{ id: string; content: string; title: string | null; chapterLabel: string; numbered: number }>(
    `SELECT b.id, b.content, b.title, c.label AS chapterLabel, c.numbered
       FROM ContentBlock b JOIN Chapter c ON c.id = b.chapterId
      WHERE c.bookId = ? AND b.type = 'soundtrack'
      ORDER BY c."order", b."order"`,
    bookId,
  ).map((t): BookTrack => ({
    id: t.id,
    audioPath: t.content,
    title: t.title,
    chapter: t.numbered ? `Chapter ${t.chapterLabel}` : t.chapterLabel,
  }))

  return (
    <BookLanding
      bookId={bookId}
      characters={characters}
      tracks={tracks}
      seriesTitle={seriesTitle}
      book={{
        title: book.title,
        synopsis: book.synopsis,
        coverPath: book.coverPath,
        order: book.order,
      }}
      chapters={list}
    />
  )
}
