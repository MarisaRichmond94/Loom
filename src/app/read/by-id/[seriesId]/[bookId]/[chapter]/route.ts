import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readerJumpPath } from '@/lib/crossAppJump'

// Reader-side companion jump target, id-addressed (KAN-12).
//
// The stable counterpart to /read/by-title/[series]/[book]/[chapter]. WriteAI
// carries Loom's series and book cuids (from the manifest sidecar), so a
// citation deep link now survives renaming either one.
//
// The chapter is still a *number*, deliberately. It is the display counter
// WriteAI ingested from the manifest, and resolving it means walking canon the
// same way the export did. Per-chapter cuids do exist in the manifest, so a
// future by-chapter-id route is possible — but citations are anchored to what
// the reader sees, and that is the number.
//
// The book is verified to belong to the series: without that check a valid
// book id from another series would resolve and deep-link across series
// boundaries.

type Params = { params: Promise<{ seriesId: string; bookId: string; chapter: string }> }

export async function GET(req: Request, { params }: Params) {
  const { seriesId, bookId, chapter } = await params
  const sid = decodeURIComponent(seriesId)
  const bid = decodeURIComponent(bookId)

  const book = await prisma.book.findUnique({
    where: { id: bid },
    select: { id: true, seriesId: true },
  })
  if (!book || book.seriesId !== sid) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const path = await readerJumpPath(sid, bid, Number(decodeURIComponent(chapter)))
  return NextResponse.redirect(
    new URL(path ?? `/preview/book/${bid}`, req.url))
}
