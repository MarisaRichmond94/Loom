import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { groupBookEvents, type BookTagRow } from '@/lib/chapterEvents'

// Which WriteAI writer-events are tagged to chapters in this book (LOOM-101).
//
// The reverse of /api/chapter-events, which runs eventIds → chapters for
// WriteAI. The book page's Timeline tab asks the other way round, and there is
// no client-side substitute: unioning the tags of every chapter would be one
// request per chapter.
//
// Returns ids and chapter positions, NOT event bodies. The events live in
// WriteAI and the page already fetches the full list from /api/writeai/events;
// joining here would make a local query fail whenever WriteAI is down, on a
// page whose other tabs render fine without it.
//
// Non-canon tags are INCLUDED, flagged rather than filtered. /api/chapter-events
// strips them because it is the one route WriteAI reads and WriteAI holds canon
// only. This route is Loom talking to Loom, and the branch-only story is
// precisely what Loom's timeline can show that WriteAI's cannot (LOOM-107).
//
// ⚠️ READ-ONLY, and it must stay that way. Chapter numbers come from the canon
// WALK (canonNumbersForBook), never the canon EXPORT: the export returns the
// same numbers but writes .pages/.txt/.docx to ~/Writing on its way there, and
// this route runs on every render of the Timeline tab. Wiring it to the export
// path would rewrite the manuscript on every page load and trigger a WriteAI
// ingest each time. tests/unit/bookEventsRoute.test.ts guards this at the
// source level, as its sibling does for /api/chapter-events.

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  // Confirms the book exists AND that it belongs to the series in the path —
  // an id pair that does not match is a caller bug, and answering it with the
  // book's real tags would make the mismatch invisible.
  const book = await prisma.book.findFirst({
    where: { id: bookId, seriesId },
    select: { id: true },
  })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  const rows = await prisma.chapterEvent.findMany({
    where: { chapter: { bookId } },
    select: {
      writerEventId: true,
      chapterId: true,
      nonCanon: true,
      chapter: { select: { title: true } },
    },
  })

  // A book with no tags still needs its canon numbers skipped, not walked —
  // loadManuscriptBook is the expensive part of this route.
  if (rows.length === 0) return NextResponse.json({ events: [] })

  // One walk for the whole book, not one per chapter or per event: a main-cast
  // event tagged across twenty chapters is one manuscript load.
  const numbers = await canonNumbersForBook(seriesId, bookId)

  return NextResponse.json({ events: groupBookEvents(rows as BookTagRow[], numbers) })
}
