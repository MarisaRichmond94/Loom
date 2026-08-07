import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readerJumpPath } from '@/lib/crossAppJump'

/**
 * A PUBLIC CROSS-APP CONTRACT — this path must not change (LOOM-137).
 *
 * WriteAI constructs these URLs itself, from a different repository, to send a
 * citation in its review pane to the right chapter in Loom. Renaming this route
 * breaks every citation link WriteAI has ever emitted, and the breakage shows
 * up over there — as a dead link, with nothing pointing back here.
 *
 * The shared `/read` prefix is misleading: this is an API-ish redirect endpoint
 * with a public contract, while its TARGET is an internal detail free to move.
 * It moved in LOOM-137 (to /author/preview/session/*) and this route did not.
 * See INTEGRATION.md, mirrored in the WriteAI repo.
 */

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
