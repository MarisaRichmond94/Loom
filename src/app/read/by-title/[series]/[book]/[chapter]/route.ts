import { NextResponse } from 'next/server'
import { bookIdForTitle, readerJumpPath, seriesIdForTitle } from '@/lib/crossAppJump'

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
