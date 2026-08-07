import { existsSync } from 'fs'
import path from 'path'

import Database from 'better-sqlite3'

import {
  listComments,
  listReaders,
  setCommentHidden,
  type Comment,
} from '@shared/readerDb'
import { readerDb, READER_DB_PATH } from '@/lib/readerInvites'

/**
 * The author's view of reader comments (LOOM-135).
 *
 * TWO WRITERS ON reader.db, DELIBERATELY. The ticket proposed routing the
 * author's Resolve/Hide through the reader app's HTTP API to keep one writer
 * per file. That premise no longer held: LOOM-132 already made Loom a writer of
 * this database — creating, renaming and disabling readers all write directly —
 * because a settings page that only works while the reader app happens to be
 * running is a worse failure than two writers.
 *
 * So moderation writes directly too, and the author's decision is recorded here
 * rather than left implicit: `reader.db` has two writing processes, WAL is on,
 * and SQLite handles that correctly. The alternative would have been two
 * different mechanisms against one file — readers created directly, comments
 * moderated over HTTP — which is the inconsistency that bites later.
 *
 * NOTHING HERE TOUCHES dev.db. Comments join to the manuscript by cuid only.
 */

export type AuthorComment = {
  id: string
  body: string
  authorName: string
  chapterId: string
  createdAt: string
  publishedAt: string | null
  hidden: boolean
  resolved: boolean
}

export type CommentsResult = {
  /** False when the reader tier has never been set up — a fresh checkout. */
  available: boolean
  chapter: AuthorComment[]
  /** Comments on chapters that are no longer published. Never silently dropped. */
  orphaned: AuthorComment[]
}

const EMPTY: CommentsResult = { available: false, chapter: [], orphaned: [] }

/**
 * `content.db`, read-only, purely to know which chapters a reader can still
 * reach.
 *
 * Overridable by the same env var the reader app uses, so a sandbox Loom checks
 * orphans against the sandbox snapshot rather than the real one — otherwise
 * every sandbox comment would look orphaned, or worse, wouldn't.
 */
function publishedChapterIds(bookId: string): Set<string> | null {
  const contentPath = process.env.READER_CONTENT_DB
    ?? path.join(process.cwd(), 'reader', 'content.db')
  if (!existsSync(contentPath)) return null
  const db = new Database(contentPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare(
      `SELECT c.id FROM Chapter c JOIN Book b ON b.id = c.bookId
        WHERE c.bookId = ? AND b.published = 1`,
    ).all(bookId) as { id: string }[]
    return new Set(rows.map(r => r.id))
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * A chapter's comments, plus this book's orphans.
 *
 * Absent `reader.db` is a NORMAL state, not an error: a fresh checkout has
 * never run the reader tier. Returning `available: false` lets the dock say so
 * in a sentence instead of rendering an empty list that reads as "nobody has
 * said anything".
 */
export function commentsForChapter(bookId: string, chapterId: string): CommentsResult {
  if (!existsSync(READER_DB_PATH)) return EMPTY

  const db = readerDb()
  const names = new Map(listReaders(db).map(r => [r.id, r.displayName]))

  const view = (c: Comment): AuthorComment => ({
    id: c.id,
    body: c.body,
    authorName: names.get(c.readerId) ?? 'A reader',
    chapterId: c.chapterId,
    createdAt: c.createdAt,
    publishedAt: c.publishedAt,
    hidden: !!c.hiddenAt,
    resolved: !!c.resolvedAt,
  })

  // The author sees hidden comments too, marked — hiding is moderation, not
  // deletion, and an accidental hide has to be findable to be reversible.
  const chapter = listComments(db, chapterId, true).map(view)

  // Orphans: rows whose chapter a reader can no longer reach. Only computable
  // when a snapshot exists; before the first publish, nothing is orphaned.
  const published = publishedChapterIds(bookId)
  const orphaned = published
    ? (db.prepare(`SELECT * FROM Comment WHERE bookId = ? ORDER BY createdAt DESC`)
        .all(bookId) as Comment[])
        .filter(c => !published.has(c.chapterId))
        .map(view)
    : []

  return { available: true, chapter, orphaned }
}

/** Unresolved, non-hidden count for the tab badge. Cheap and absence-tolerant. */
export function unresolvedCount(chapterId: string): number {
  if (!existsSync(READER_DB_PATH)) return 0
  const row = readerDb().prepare(
    `SELECT COUNT(*) AS n FROM Comment
      WHERE chapterId = ? AND hiddenAt IS NULL AND resolvedAt IS NULL`,
  ).get(chapterId) as { n: number }
  return row?.n ?? 0
}

/**
 * Author bookkeeping. Invisible to readers — resolving is "I have read this",
 * not "this should go away".
 */
export function setResolved(id: string, resolved: boolean): void {
  if (!existsSync(READER_DB_PATH)) return
  readerDb().prepare(`UPDATE Comment SET resolvedAt = ? WHERE id = ?`)
    .run(resolved ? new Date().toISOString() : null, id)
}

/**
 * Moderation. Reader-facing, and SOFT — the row stays, marked, and the author
 * can put it back. There is deliberately no hard-delete path anywhere in this
 * file: nothing a family member wrote should be destroyable by a mis-click.
 */
export function setHidden(id: string, hidden: boolean): void {
  if (!existsSync(READER_DB_PATH)) return
  setCommentHidden(readerDb(), id, hidden)
}
