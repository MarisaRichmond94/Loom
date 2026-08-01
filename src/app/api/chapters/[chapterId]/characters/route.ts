import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import {
  groupAppearances,
  parseWriterCharacterId,
  type SpreadRow,
  type TaggedCharacter,
} from '@/lib/chapterCharacters'

type Params = { params: Promise<{ chapterId: string }> }

// The WriteAI writer-characters appearing in one chapter (LOOM-33).
//
// Loom stores ids only — this route never knows a character's name or photo,
// and never calls WriteAI. The sidebar resolves ids against WriteAI itself, so
// one that no longer exists there simply stops rendering: unknown identity,
// not an error, never auto-deleted.

/**
 * Tagged character ids for this chapter, each with the OTHER chapters they
 * appear in — the expanded card's appearance list.
 *
 * Canon numbers come from one walk per distinct book rather than one per
 * chapter; a main character across forty chapters of one book would otherwise
 * reload and re-walk that manuscript forty times.
 */
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params

  const mine = await prisma.chapterCharacter.findMany({
    where: { chapterId },
    select: { writerCharacterId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (mine.length === 0) return NextResponse.json({ characters: [] })

  const ids = mine.map(c => c.writerCharacterId)
  const rows = await prisma.chapterCharacter.findMany({
    where: { writerCharacterId: { in: ids } },
    select: {
      writerCharacterId: true,
      chapterId: true,
      chapter: {
        select: {
          title: true,
          bookId: true,
          book: { select: { title: true, order: true, seriesId: true } },
        },
      },
    },
  })

  const books = new Map<string, string>() // bookId -> seriesId
  for (const row of rows) {
    if (row.chapterId !== chapterId) books.set(row.chapter.bookId, row.chapter.book.seriesId)
  }
  const numbers = new Map<string, number | null>()
  for (const [bookId, seriesId] of books) {
    for (const [id, n] of await canonNumbersForBook(seriesId, bookId)) numbers.set(id, n)
  }

  const spread = groupAppearances(rows as SpreadRow[], chapterId, numbers)
  const characters: TaggedCharacter[] = mine.map(c => ({
    writerCharacterId: c.writerCharacterId,
    taggedAt: c.createdAt.toISOString(),
    alsoIn: spread.get(c.writerCharacterId) ?? [],
  }))
  return NextResponse.json({ characters })
}

/**
 * Tag a character to this chapter.
 *
 * Idempotent by constraint rather than by check-then-insert: re-tagging
 * returns 200 with the existing row. Reading first and inserting second would
 * race two clicks into a 500, and the @@unique index already knows the answer.
 */
export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const parsed = parseWriterCharacterId(payload)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const tag = await prisma.chapterCharacter.create({
      data: { chapterId, writerCharacterId: parsed.id },
      select: { writerCharacterId: true, createdAt: true },
    })
    return NextResponse.json({
      writerCharacterId: tag.writerCharacterId,
      taggedAt: tag.createdAt.toISOString(),
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    // P2002 — already tagged. The desired state holds, so this is a success.
    if (code === 'P2002') {
      const existing = await prisma.chapterCharacter.findUnique({
        where: { chapterId_writerCharacterId: { chapterId, writerCharacterId: parsed.id } },
        select: { createdAt: true },
      })
      return NextResponse.json({
        writerCharacterId: parsed.id,
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
