import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadManuscriptBook } from '@/lib/manuscript/loadBook'
import { defaultStoryState, walkBook } from '@/lib/manuscript/walk'
import { buildInitialState, serializeSession } from '@/lib/sessionService'

// Reader-side companion jump target. WriteAI cites sources by series title,
// book title, and a chapter *number* — the display counter that skips
// unnumbered chapters (prologue = 0), NOT Loom's Chapter.order. It has no
// Loom ids. So we resolve title -> series, title -> book, then walk the book
// exactly the way the canon export does and map the requested number to the
// chapter's cuid the same way the manifest does. Reusing walkBook guarantees
// the number we match on is byte-for-byte the one WriteAI ingested.
//
// On a hit we mint a fresh reader session and 302 into /read; the reader page
// seeds state to reveal gated chapters on a fresh session, so this lands on
// the cited chapter's text even when it's conditional. Misses fall back to a
// soft landing (the book preview, or home) rather than a 404.

// Apostrophes and unicode composition are the realistic ways a citation's
// title and a DB title drift apart while still "being" the same title.
function normalizeTitle(s: string): string {
  return s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
}

type Params = { params: Promise<{ series: string; book: string; chapter: string }> }

export async function GET(req: Request, { params }: Params) {
  const { series, book, chapter } = await params
  const wantSeries = normalizeTitle(decodeURIComponent(series))
  const wantBook = normalizeTitle(decodeURIComponent(book))
  const wantChapter = Number(decodeURIComponent(chapter))

  const home = () => NextResponse.redirect(new URL('/', req.url))

  // SQLite Prisma has no case-insensitive filter and these lists are tiny,
  // so match in memory (same approach as the author-side by-title route).
  const allSeries = await prisma.series.findMany({ select: { id: true, title: true } })
  const matchedSeries = allSeries.find(s => normalizeTitle(s.title) === wantSeries)
  if (!matchedSeries) return home()

  const books = await prisma.book.findMany({
    where: { seriesId: matchedSeries.id },
    select: { id: true, title: true },
  })
  const matchedBook = books.find(b => normalizeTitle(b.title) === wantBook)
  if (!matchedBook) return home()

  // Land on the book preview if we can't resolve the specific chapter — the
  // reader can pick up from there rather than hitting a dead end.
  const bookPreview = () =>
    NextResponse.redirect(new URL(`/preview/book/${matchedBook.id}`, req.url))

  if (!Number.isInteger(wantChapter)) return bookPreview()

  const data = await loadManuscriptBook(matchedSeries.id, matchedBook.id)
  if (!data) return bookPreview()

  // Pure canon walk (every variable at its default) — the same walk that
  // produced the numbering WriteAI read back from the manifest.
  const walk = walkBook(data.chapters, data.variables, defaultStoryState(data.variables), {})
  const target = walk.chapters.find(ch => {
    const number = ch.numbered
      ? Number(ch.label)
      : (ch.label.trim().toLowerCase() === 'prologue' ? 0 : null)
    return number === wantChapter
  })
  if (!target) return bookPreview()

  // Fresh reader session (mirrors POST /api/sessions), then deep-link into the
  // reader at the cited chapter.
  const variables = await prisma.storyVariable.findMany({ where: { seriesId: matchedSeries.id } })
  const { storyState, choiceHistory } = serializeSession(buildInitialState(variables), [])
  const session = await prisma.readerSession.create({
    data: { seriesId: matchedSeries.id, currentBlockId: null, storyState, choiceHistory },
  })

  const dest = new URL(`/read/${session.id}`, req.url)
  dest.searchParams.set('startChapterId', target.id)
  return NextResponse.redirect(dest)
}
