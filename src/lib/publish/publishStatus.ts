import { existsSync } from 'node:fs'
import { openReadOnly } from '@/lib/readonlyDb'
import { buildContentDb } from '@/lib/publish/buildContent'

/**
 * What readers are seeing right now, and how far behind it is (LOOM-129).
 *
 * Two concepts the UI must not conflate:
 *   - `Book.published` — "this book is ELIGIBLE to be seen"
 *   - the published snapshot — "this is what readers can actually read"
 * A book can be published:true and still not be in anyone's hands because
 * publish has not run. Showing only one of the two would be actively
 * misleading.
 *
 * Drift is exact, not estimated: the current fingerprint is produced by running
 * the real publish pipeline in dry-run mode, so the answer to "would publishing
 * change anything?" comes from the code that would do the changing. Word counts
 * would have been cheaper and would have lied at the edges — a rewrite that
 * keeps the length, or a re-ordered chapter, is exactly the change worth
 * flagging.
 */

export type BookStatus = {
  id: string
  title: string
  order: number
  /** Loom's flag: is this book eligible to be published at all? */
  eligible: boolean
  /** Is it in the current snapshot with real content (not a stub)? */
  inSnapshot: boolean
  /** Eligible, in the snapshot, and unchanged since. */
  changed: boolean
  /** When THIS book was last published. Books move independently now. */
  publishedAt: string | null
  chapters: number
  narrated: number
  narrationMismatched: string[]
  warnings: string[]
}

export type PublishStatus = {
  /** Most recent publish of anything. Null when nothing has ever been sent. */
  publishedAt: string | null
  everPublished: boolean
  /** True when any eligible book differs from the snapshot, or is missing from it. */
  stale: boolean
  books: BookStatus[]
}

export function readPublishStatus(opts: {
  sourcePath: string
  contentPath: string
  seriesId: string
  authorName: string
}): PublishStatus {
  const published = new Map<string, string>()
  let publishedAt: string | null = null

  if (existsSync(opts.contentPath)) {
    const db = openReadOnly(opts.contentPath)
    try {
      for (const row of db.prepare(`SELECT key, value FROM PublishMeta`).all() as { key: string; value: string }[]) {
        if (row.key === 'publishedAt') publishedAt = row.value
        else if (row.key.startsWith('book:')) published.set(row.key, row.value)
      }
    } finally {
      db.close()
    }
  }

  // Dry run with bookIds undefined: rebuild EVERY book, so each one's current
  // fingerprint is computed from the manuscript rather than carried forward.
  // Carrying forward here would compare a book against itself and report every
  // book as unchanged — the status would always say "you are up to date".
  //
  // It writes to a separate path so it can never disturb the live snapshot.
  const current = buildContentDb({
    sourcePath: opts.sourcePath,
    outPath: `${opts.contentPath}.status`,
    seriesId: opts.seriesId,
    authorName: opts.authorName,
    publishedAt: publishedAt ?? '',
    dryRun: true,
  })

  const books: BookStatus[] = current.books.map(b => {
    const snapshotHash = published.get(`book:${b.id}:hash`)
    return {
      id: b.id,
      title: b.title,
      order: b.order,
      eligible: b.eligible,
      inSnapshot: !!snapshotHash,
      // A draft is never "changed" — it has nothing a reader could be behind on.
      changed: b.eligible && snapshotHash !== b.contentHash,
      publishedAt: published.get(`book:${b.id}:publishedAt`) || null,
      chapters: b.chapters,
      narrated: b.narrated,
      narrationMismatched: b.narrationMismatched,
      warnings: b.warnings,
    }
  })

  return {
    publishedAt,
    everPublished: publishedAt !== null,
    stale: books.some(b => b.changed),
    books,
  }
}
