import { notFound } from 'next/navigation'
import ChapterView, { type ChapterNav, type ProseBlock } from '@/components/ChapterView'
import { type BookCharacter } from '@/components/BookLanding'
import { hasContent, query } from '@/lib/db'
import { requireReader, readerDbHandle } from '@/lib/readers'
import { getProgress } from '@/shared/readerDb'
import { commentsFor } from '@/lib/comments'

export const dynamic = 'force-dynamic'

type ChapterRow = {
  id: string; bookId: string; title: string; label: string
  numbered: number; order: number; pov: string | null; date: string | null
}

export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string; chapterId: string }>
  searchParams: Promise<{ resume?: string; moved?: string }>
}) {
  const reader = await requireReader()
  const { bookId, chapterId } = await params
  const sp = await searchParams
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

  const characters = query<{ id: string; name: string; age: number | null; photoPath: string | null; deceased: number }>(
    `SELECT id, name, age, photoPath, deceased FROM Character WHERE bookId = ?`, bookId,
  ).map((c): BookCharacter => ({
    id: c.id, name: c.name, age: c.age, photoPath: c.photoPath, deceased: !!c.deceased,
  }))

  // The POV is stored as a NAME on the chapter, so resolving it to a character
  // has to happen by name — the one place that is unavoidable. Done here rather
  // than client-side so the byline card behaves like any other mention.
  const povCharacterId = chapter.pov
    ? characters.find(c => c.name === chapter.pov)?.id ?? null
    : null

  // `timing` is the reconciled per-token map publish stored beside the audio —
  // what drives the word highlight. Parsed here rather than in the client so a
  // corrupt row degrades to a plain transport instead of throwing in the
  // browser: the audio is still worth having without the highlight.
  // blockIds arrived with the word highlight. A snapshot published before it
  // still has perfectly good audio, so an older file degrades to a plain
  // transport rather than 500-ing the chapter — the fix is a republish, and a
  // chapter that won't open is a worse way to learn that than one that plays.
  const hasBlockIds = query<{ name: string }>(`PRAGMA table_info(Narration)`)
    .some(c => c.name === 'blockIds')

  const row = query<{ audioPath: string; durationMs: number; timing: string; blockIds: string }>(
    `SELECT audioPath, durationMs, timing, ${hasBlockIds ? 'blockIds' : `'[]' AS blockIds`}
     FROM Narration WHERE chapterId = ?`, chapterId,
  )[0] ?? null

  // Both are JSON columns publish wrote. Parsed here rather than in the client
  // so a corrupt row degrades to a plain transport instead of throwing in the
  // browser — the audio is still worth having without the highlight.
  const json = <T,>(s: string, what: string): T[] => {
    try {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      console.warn(`[narration] unreadable ${what} for chapter ${chapterId}`)
      return []
    }
  }
  const narration = row && {
    audioPath: row.audioPath,
    durationMs: row.durationMs,
    timing: json<{ word: string; timeMs: number }>(row.timing, 'timing'),
    blockIds: json<string>(row.blockIds, 'blockIds'),
  }

  // Restoring is opt-in via ?resume=1. Someone who clicked a chapter link wants
  // the top of that chapter; only a Continue card asks to be dropped back into
  // the middle of one. The offset still comes from the SERVER's row, never the
  // URL — a query parameter is not a position.
  const saved = sp.resume === '1' ? getProgress(readerDbHandle(), reader.id, bookId) : null
  const resumeOffset = saved?.chapterId === chapterId ? saved.offset : 0

  // `moved` only selects which sentence to show; the ladder already decided.
  const resumeNotice =
    sp.moved === 'previous'
      ? 'That chapter was revised, so you’re back at the start of the one before it.'
      : sp.moved === 'restart'
        ? 'That chapter was revised, so you’re back at the beginning of the book.'
        : null

  // Null when they have not finished — the component renders one line and no
  // count, because a count is itself a signal that something happens here.
  const publishedAt = query<{ value: string }>(
    `SELECT value FROM PublishMeta WHERE key = 'publishedAt'`,
  )[0]?.value ?? null
  const comments = commentsFor(reader.id, bookId, chapterId, publishedAt)

  return (
    <ChapterView
      comments={comments}
      chapterId={chapterId}
      resumeOffset={resumeOffset}
      resumeNotice={resumeNotice}
      narration={narration}
      characters={characters}
      povCharacterId={povCharacterId}
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
