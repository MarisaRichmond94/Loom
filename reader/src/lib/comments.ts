import { addComment, deleteOwnComment, listComments, listReaders, type Comment } from '@/shared/readerDb'
import { hasFinishedChapter } from '@/shared/commentGate'
import { getProgress } from '@/shared/readerDb'
import { query } from '@/lib/db'
import { readerDbHandle } from '@/lib/readers'

/**
 * Reader comments (LOOM-134).
 *
 * THE GATE IS ENFORCED HERE, not in the component. A page that merely declines
 * to render a thread is a curtain, not a wall — the data still crossed the
 * network, and anyone who opens devtools or fetches the endpoint directly has
 * it. Since the thing being protected is "my mother spoils chapter 12 for my
 * husband", the check has to sit where the rows are read.
 */

export type CommentView = {
  id: string
  body: string
  authorName: string
  createdAt: string
  /** True when the viewer wrote it, so only they are offered a delete. */
  mine: boolean
  /** True when the chapter was republished after this was written. */
  onOlderVersion: boolean
}

/**
 * How many paragraphs a chapter has, counted from the published HTML.
 *
 * The client counts rendered <p> elements; this counts them in the stored
 * markup. They are the same paragraphs, but the gate tolerates a disagreement
 * of one rather than assuming two different counters can never drift.
 */
export function paragraphCount(chapterId: string): number {
  const blocks = query<{ content: string }>(
    `SELECT content FROM ContentBlock WHERE chapterId = ? AND type != 'soundtrack' ORDER BY "order"`,
    chapterId,
  )
  return blocks.reduce((n, b) => n + (b.content.match(/<p[\s>]/g)?.length ?? 0), 0)
}

/** Chapter ids for a book, in published order — the gate's view of what exists. */
function orderedChapterIds(bookId: string): string[] {
  return query<{ id: string }>(
    `SELECT c.id FROM Chapter c JOIN Book b ON b.id = c.bookId
      WHERE c.bookId = ? AND b.published = 1 ORDER BY c."order"`,
    bookId,
  ).map(c => c.id)
}

/** Whether this viewer has earned the right to see a chapter's discussion. */
export function canSeeComments(readerId: string, bookId: string, chapterId: string): boolean {
  const saved = getProgress(readerDbHandle(), readerId, bookId)
  return hasFinishedChapter({
    chapterIds: orderedChapterIds(bookId),
    chapterId,
    atChapterId: saved?.chapterId ?? null,
    atOffset: saved?.offset ?? 0,
    paragraphCount: paragraphCount(chapterId),
  })
}

/**
 * A chapter's visible comments, or null when the viewer has not finished it.
 *
 * Null rather than an empty array, deliberately: the caller must not be able to
 * confuse "nobody has commented" with "you may not see this", because the two
 * render differently and only one of them may reveal a count.
 */
export function commentsFor(
  readerId: string,
  bookId: string,
  chapterId: string,
  publishedAt: string | null,
): CommentView[] | null {
  if (!canSeeComments(readerId, bookId, chapterId)) return null

  const db = readerDbHandle()
  const names = new Map(listReaders(db).map(r => [r.id, r.displayName]))

  return listComments(db, chapterId).map((c: Comment): CommentView => ({
    id: c.id,
    body: c.body,
    // A comment outlives the reader row only if one is deleted; say something
    // neutral rather than rendering a bare id.
    authorName: names.get(c.readerId) ?? 'A reader',
    createdAt: c.createdAt,
    mine: c.readerId === readerId,
    // The chapter has been republished since this was written, so it may be
    // reacting to prose that no longer exists. Worth marking rather than
    // letting the comment read as simply wrong.
    onOlderVersion: !!(publishedAt && c.publishedAt && c.publishedAt < publishedAt),
  }))
}

/** Adds a comment, refusing anyone who has not finished the chapter. */
export function postComment(
  readerId: string,
  bookId: string,
  chapterId: string,
  body: string,
  publishedAt: string | null,
): { ok: true } | { ok: false; reason: 'gated' | 'empty' } {
  if (!body.trim()) return { ok: false, reason: 'empty' }
  // Commenting on a chapter you have not finished is the same spoiler risk in
  // reverse — you would be writing into a thread you cannot see.
  if (!canSeeComments(readerId, bookId, chapterId)) return { ok: false, reason: 'gated' }

  addComment(readerDbHandle(), { readerId, bookId, chapterId, body, publishedAt })
  return { ok: true }
}

/**
 * A reader retracting their own words. Hard delete, unlike the author's
 * moderation hide (LOOM-135) — this is someone's own comment, and taking it
 * back is theirs to do.
 */
export function removeOwnComment(readerId: string, commentId: string): boolean {
  return deleteOwnComment(readerDbHandle(), commentId, readerId)
}
