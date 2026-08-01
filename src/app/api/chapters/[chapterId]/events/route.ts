import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { groupAppearances, parseWriterEventId, type SpreadRow, type TaggedEvent } from '@/lib/chapterEvents'

type Params = { params: Promise<{ chapterId: string }> }

// The WriteAI writer-events tagged to one chapter (LOOM-32).
//
// Loom stores ids only — this route never knows an event's title or date, and
// never calls WriteAI. The sidebar resolves the ids against WriteAI itself, so
// an id that no longer exists there simply stops rendering: unknown identity,
// not an error, and never auto-deleted. See INTEGRATION.md.

/**
 * Tagged event ids for this chapter, each with the OTHER chapters it appears
 * in — the sidebar's "also in Ch. 7", which is the thing that is invisible
 * today and half the reason to open the tab.
 *
 * Canon numbers come from one walk per distinct book rather than one per
 * chapter; an event tagged across twenty chapters of the same book would
 * otherwise reload and re-walk that manuscript twenty times.
 */
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params

  const mine = await prisma.chapterEvent.findMany({
    where: { chapterId },
    select: { writerEventId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (mine.length === 0) return NextResponse.json({ events: [] })

  const ids = mine.map(e => e.writerEventId)
  const rows = await prisma.chapterEvent.findMany({
    where: { writerEventId: { in: ids } },
    select: {
      writerEventId: true,
      chapterId: true,
      chapter: {
        select: {
          title: true,
          bookId: true,
          book: { select: { title: true, seriesId: true } },
        },
      },
    },
  })

  // One walk per book that actually appears in the spread.
  const books = new Map<string, string>() // bookId -> seriesId
  for (const row of rows) {
    if (row.chapterId !== chapterId) books.set(row.chapter.bookId, row.chapter.book.seriesId)
  }
  const numbers = new Map<string, number | null>()
  for (const [bookId, seriesId] of books) {
    for (const [id, n] of await canonNumbersForBook(seriesId, bookId)) numbers.set(id, n)
  }

  const spread = groupAppearances(rows as SpreadRow[], chapterId, numbers)
  const events: TaggedEvent[] = mine.map(e => ({
    writerEventId: e.writerEventId,
    taggedAt: e.createdAt.toISOString(),
    alsoIn: spread.get(e.writerEventId) ?? [],
  }))
  return NextResponse.json({ events })
}

/**
 * Tag an event to this chapter.
 *
 * Idempotent by constraint, not by check-then-insert: re-tagging returns 200
 * with the existing row. Reading first and inserting second would race two
 * clicks into a 500, and the @@unique index already knows the answer.
 */
export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const parsed = parseWriterEventId(payload)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const tag = await prisma.chapterEvent.create({
      data: { chapterId, writerEventId: parsed.id },
      select: { writerEventId: true, createdAt: true },
    })
    return NextResponse.json({ writerEventId: tag.writerEventId, taggedAt: tag.createdAt.toISOString() })
  } catch (err) {
    const code = (err as { code?: string }).code
    // P2002 — already tagged. The desired state holds, so this is a success.
    if (code === 'P2002') {
      const existing = await prisma.chapterEvent.findUnique({
        where: { chapterId_writerEventId: { chapterId, writerEventId: parsed.id } },
        select: { writerEventId: true, createdAt: true },
      })
      return NextResponse.json({
        writerEventId: parsed.id,
        taggedAt: existing?.createdAt.toISOString() ?? null,
        alreadyTagged: true,
      })
    }
    // P2003 — the chapter was deleted between the tab loading and this landing.
    if (code === 'P2003') {
      return NextResponse.json({ error: 'chapter not found' }, { status: 404 })
    }
    throw err
  }
}
