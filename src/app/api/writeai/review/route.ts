import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewNumberForChapter } from '@/lib/crossAppJump'

// The latest WriteAI review for a chapter, for the editor's Review panel
// (KAN-22).
//
// A SERVER-SIDE proxy, not a browser fetch, for three reasons:
//   * sessions.json is ~6 MB and holds every review and explore conversation.
//     Filtering here means the browser receives one session, not the archive.
//   * same-origin, so no CORS and no WriteAI URL in client code.
//   * the WriteAI base URL stays server-side.
//
// Read-only. Resolving the chapter's address uses the canon walk rather than
// the export endpoint, which returns the same number but writes the manuscript
// to ~/Writing as a side effect.

type ReviewSession = {
  id: string
  label?: string
  book?: string
  chapter?: number
  focus?: string
  draft?: boolean
  timestamp?: string
  messages?: unknown[]
}

const norm = (s: string) =>
  s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()

export async function GET(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  const bookId = url.searchParams.get('bookId')
  const chapterId = url.searchParams.get('chapterId')
  if (!seriesId || !bookId || !chapterId) {
    return NextResponse.json({ error: 'seriesId, bookId and chapterId are required' }, { status: 400 })
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { title: true, seriesId: true },
  })
  if (!book || book.seriesId !== seriesId) {
    return NextResponse.json({ error: 'unknown book' }, { status: 404 })
  }

  // No canon address (unnumbered chapter, or one the walk skips) means WriteAI
  // has no way to have reviewed it. Not an error — just nothing to show.
  const chapter = await reviewNumberForChapter(seriesId, bookId, chapterId)
  if (chapter === null) {
    return NextResponse.json({ review: null, reason: 'chapter-not-addressable' })
  }

  const base = process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:8000'
  let sessions: { review?: ReviewSession[] }
  try {
    const res = await fetch(`${base}/api/sessions`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`sessions responded ${res.status}`)
    sessions = await res.json()
  } catch (err) {
    // WriteAI being down must not break the chapter editor. The panel shows
    // "unavailable" rather than an error state the writer has to dismiss.
    return NextResponse.json(
      { review: null, reason: 'writeai-unavailable',
        detail: err instanceof Error ? err.message : 'unknown' },
      { status: 200 },
    )
  }

  const matches = (sessions.review ?? []).filter(
    s => s.chapter === chapter && typeof s.book === 'string' && norm(s.book) === norm(book.title),
  )
  if (matches.length === 0) {
    return NextResponse.json({ review: null, reason: 'none', chapter })
  }

  // Newest by timestamp. Sessions carry an ISO string; fall back to array
  // order when one is missing rather than dropping the session.
  matches.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
  const latest = matches[0]

  return NextResponse.json({
    review: latest,
    chapter,
    total: matches.length,
  })
}
