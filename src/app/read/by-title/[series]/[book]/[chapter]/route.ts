import { NextResponse } from 'next/server'
import { bookIdForTitle, readerJumpPath, seriesIdForTitle } from '@/lib/crossAppJump'

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

// Reader-side companion jump target, title-addressed.
//
// WriteAI cites sources by series title, book title, and a chapter *number* —
// the display counter that skips unnumbered chapters (prologue = 0), NOT
// Loom's Chapter.order.
//
// Superseded by /read/by-id/[seriesId]/[bookId]/[chapter] (KAN-12) but kept
// indefinitely: citations already rendered in the wild carry titles, and older
// WriteAI builds can express nothing else. Renaming a book breaks this route
// and not the by-id one.
//
// Misses fall back to a soft landing (the book preview, or home) rather than
// a 404.

type Params = { params: Promise<{ series: string; book: string; chapter: string }> }

export async function GET(req: Request, { params }: Params) {
  const { series, book, chapter } = await params

  const seriesId = await seriesIdForTitle(decodeURIComponent(series))
  if (!seriesId) return NextResponse.redirect(new URL('/', req.url))

  const bookId = await bookIdForTitle(seriesId, decodeURIComponent(book))
  if (!bookId) return NextResponse.redirect(new URL('/', req.url))

  const path = await readerJumpPath(seriesId, bookId, Number(decodeURIComponent(chapter)))
  return NextResponse.redirect(
    new URL(path ?? `/preview/book/${bookId}`, req.url))
}
