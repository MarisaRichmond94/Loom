import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { statusForBook, type BookStatus } from '@/lib/manuscript/canonStatus'

// Is each book's canon export on disk current with the database? (KAN-13)
//
// The nightly backup used to answer this by comparing each .pages file's mtime
// against dev.db's. That could not work: dev.db is touched by an edit to ANY
// book, so its mtime is "now" every night, and every book the writer wasn't
// actively working on tripped the threshold. The warning fired most nights,
// for books that were perfectly fine, and so meant nothing.
//
// The per-book check itself now lives in lib/manuscript/canonStatus.ts, so the
// book card's regenerate menu can ask about one book without hashing all of
// them (LOOM-157). This endpoint is the series-wide sweep the backup script
// calls, and nothing more.
//
// Read-only by construction — see the library.

export const dynamic = 'force-dynamic'

export async function GET() {
  // Demo series are generated fixtures for the Explore page; they are never
  // exported and must not appear as perpetually-stale books in the log.
  //
  // Non-canon books are excluded for exactly the same reason (LOOM-149, under
  // LOOM-146). They have no folder under the canon root and never will, so they
  // would report `no-folder` on every run — a WARNING every night, for a book
  // that is behaving perfectly. That is the precise failure this endpoint's
  // header describes itself as existing to fix, and re-introducing it here
  // would make the whole check mean nothing again.
  const books = await prisma.book.findMany({
    where: { series: { demo: false }, canon: true },
    select: { id: true, seriesId: true, title: true, order: true },
    orderBy: { order: 'asc' },
  })

  const results: BookStatus[] = []
  for (const b of books) {
    try {
      results.push(await statusForBook(b))
    } catch (err) {
      // One unreadable book must not deny the caller a verdict on the others.
      results.push({
        bookId: b.id,
        seriesId: b.seriesId,
        title: b.title,
        order: b.order,
        current: false,
        reason: 'error',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    books: results,
    stale: results.filter(r => !r.current).length,
  })
}
