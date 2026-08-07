import { getProgress, listProgress, saveProgress, dropProgress } from '@/shared/readerDb'
import { resolveResume, resumeNotice, type Resume } from '@/shared/resumeLadder'
import { query } from '@/lib/db'
import { readerDbHandle } from '@/lib/readers'

/**
 * Reading progress (LOOM-133).
 *
 * Positions live in `reader.db`; the chapters they point at live in
 * `content.db`. That is a join ACROSS FILES with no foreign key, and it is
 * deliberate — republishing can legitimately delete the chapter someone is
 * standing in, and the right answer is a resolution ladder, not a constraint
 * refusing the write.
 *
 * Everything here resolves by id. Chapter numbers shift whenever a chapter is
 * inserted or unpublished, so a number-based lookup produces a position that
 * looks right and points at the wrong prose.
 */

export type ResumePoint = {
  bookId: string
  chapterId: string
  offset: number
  /** Set only when the ladder MOVED them, so the page can say why. */
  notice: string | null
  /** False when they have never opened this book. */
  started: boolean
}

/** The book's chapters in published order — the ladder's view of what exists. */
function chapterIds(bookId: string): { id: string }[] {
  return query<{ id: string }>(
    `SELECT c.id FROM Chapter c JOIN Book b ON b.id = c.bookId
      WHERE c.bookId = ? AND b.published = 1 ORDER BY c."order"`,
    bookId,
  )
}

/**
 * Where this reader should land in a book, or null when the book has nothing
 * to open. Also prunes a position whose book has left the snapshot entirely —
 * there is nothing it could ever resolve to again.
 */
export function resumeFor(readerId: string, bookId: string): ResumePoint | null {
  const db = readerDbHandle()
  const saved = getProgress(db, readerId, bookId)
  const chapters = chapterIds(bookId)

  const resolved: Resume = resolveResume(chapters, {
    chapterId: saved?.chapterId ?? null,
    offset: saved?.offset ?? 0,
    prevChapterId: saved?.prevChapterId ?? null,
  })

  if (resolved.kind === 'gone') {
    if (saved) dropProgress(db, readerId, bookId)
    return null
  }

  return {
    bookId,
    chapterId: resolved.chapterId,
    offset: resolved.offset,
    notice: resumeNotice(resolved, !!saved?.chapterId),
    started: !!saved,
  }
}

export type ContinueCard = ResumePoint & {
  title: string
  coverPath: string | null
  chapterLabel: string
  chapterNumbered: boolean
  updatedAt: string
}

/**
 * The Continue Reading rail: every book this reader has started, most recent
 * first. Books whose rows no longer resolve are dropped rather than rendered
 * as a card that goes nowhere.
 */
export function continueReading(readerId: string): ContinueCard[] {
  const cards: ContinueCard[] = []

  for (const row of listProgress(readerDbHandle(), readerId)) {
    const point = resumeFor(readerId, row.bookId)
    if (!point) continue

    const book = query<{ title: string; coverPath: string | null }>(
      `SELECT title, coverPath FROM Book WHERE id = ? AND published = 1`, row.bookId,
    )[0]
    if (!book) continue

    const chapter = query<{ label: string; numbered: number }>(
      `SELECT label, numbered FROM Chapter WHERE id = ?`, point.chapterId,
    )[0]
    if (!chapter) continue

    cards.push({
      ...point,
      title: book.title,
      coverPath: book.coverPath,
      chapterLabel: chapter.label,
      // `!!` — SQLite has no boolean, and `0 && x` renders a literal "0".
      chapterNumbered: !!chapter.numbered,
      updatedAt: row.updatedAt,
    })
  }

  return cards
}

/**
 * Records a position. `prevChapterId` is captured here, while the chapter's
 * neighbour is still knowable — after a republish deletes the chapter, nothing
 * left in the snapshot could tell us what preceded it.
 */
export function recordProgress(
  readerId: string,
  bookId: string,
  chapterId: string,
  offset: number,
): void {
  // Resolved server-side rather than trusted from the client: the client knows
  // its own neighbour, but it is also the one place this could be spoofed into
  // pointing a future recovery at prose the reader has not reached.
  const prev = query<{ id: string }>(
    `SELECT prev.id FROM Chapter cur
       JOIN Chapter prev ON prev.bookId = cur.bookId AND prev."order" < cur."order"
      WHERE cur.id = ?
      ORDER BY prev."order" DESC LIMIT 1`,
    chapterId,
  )[0]

  saveProgress(readerDbHandle(), readerId, bookId, chapterId, offset, prev?.id ?? null)
}
