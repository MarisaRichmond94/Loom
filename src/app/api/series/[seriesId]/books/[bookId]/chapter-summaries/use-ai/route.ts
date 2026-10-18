import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

// "Sync" on the outline board: switch chapters back to WriteAI's generated
// summary, one card (the hover icon) or many (the bulk modal).
//
// Writes the "" marker row the summary route documents — never deletes the
// row, so a legacy summary typed into WriteAI's own outline card cannot
// resurface as the writer's. Nothing here reads or writes WriteAI: the AI text
// itself stays where it lives, and the board simply stops covering it.
//
// One transaction for the whole selection, so a bulk sync is all or nothing —
// a modal that reports "12 synced" must not have quietly synced 7.

const MAX_IDS = 1000

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const body = (await req.json().catch(() => null)) as { chapterIds?: unknown } | null
  const ids = body?.chapterIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string')) {
    return NextResponse.json({ error: `chapterIds must be 1–${MAX_IDS} chapter ids` }, { status: 400 })
  }
  const unique = [...new Set(ids as string[])]

  const book = await prisma.book.findFirst({ where: { id: bookId, seriesId }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  // Every id must belong to THIS book. A mismatch is a caller bug, and
  // applying the rest would make it invisible.
  const owned = await prisma.chapter.findMany({ where: { id: { in: unique }, bookId }, select: { id: true } })
  if (owned.length !== unique.length) {
    return NextResponse.json({ error: 'some chapters are not in this book' }, { status: 400 })
  }

  await prisma.$transaction(
    unique.map(chapterId =>
      prisma.chapterSummary.upsert({
        where: { chapterId },
        create: { chapterId, body: '' },
        update: { body: '' },
      }),
    ),
  )
  return NextResponse.json({ ok: true, synced: unique.length })
}
