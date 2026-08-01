import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { buildChapterLinks, parseEventIds, type LinkRow } from '@/lib/chapterEvents'

// Which Loom chapters reference a set of WriteAI writer-events (LOOM-32).
//
// The outbound half of the seam: WriteAI's timeline calls this to turn the
// event ids it holds into displayable chapter links. Loom is the only place
// that can answer, because it owns both the join and the canon numbering.
//
// ⚠️ READ-ONLY, and it must stay that way. Chapter numbers come from the canon
// WALK (canonNumbersForBook), never the canon EXPORT: the export returns the
// same numbers but writes .pages/.txt/.docx to ~/Writing on its way there, and
// this route runs on every timeline render. Wiring it to the export path would
// rewrite the manuscript on every page load and trigger a WriteAI ingest each
// time. tests/unit/chapterEventsRoute.test.ts guards this at the source level.

export async function GET(req: Request) {
  const ids = parseEventIds(new URL(req.url).searchParams.get('eventIds'))
  if (ids.length === 0) return NextResponse.json({})

  const rows = await prisma.chapterEvent.findMany({
    where: { writerEventId: { in: ids } },
    select: {
      writerEventId: true,
      chapterId: true,
      chapter: {
        select: {
          title: true,
          bookId: true,
          book: { select: { title: true, order: true, seriesId: true, series: { select: { title: true } } } },
        },
      },
    },
  })

  // One walk per distinct book, not per chapter. A main-cast event tagged
  // across twenty chapters of one book is one manuscript load, not twenty.
  const books = new Map<string, string>() // bookId -> seriesId
  for (const row of rows) books.set(row.chapter.bookId, row.chapter.book.seriesId)
  const numbers = new Map<string, number | null>()
  for (const [bookId, seriesId] of books) {
    for (const [id, n] of await canonNumbersForBook(seriesId, bookId)) numbers.set(id, n)
  }

  return NextResponse.json(buildChapterLinks(ids, rows as LinkRow[], numbers))
}
