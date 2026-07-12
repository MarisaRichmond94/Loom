import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { publishEvent } from '@/lib/eventBus'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      chapters: {
        include: {
          blocks: {
            include: { choices: true, overrides: true },
          },
        },
      },
    },
  })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const chapterCount = book.chapters.length
  const uniquePovs = new Set(book.chapters.map(c => c.pov).filter(Boolean)).size
  const choiceCount = book.chapters.reduce(
    (sum, c) => sum + c.blocks.filter(b => b.type === 'choice_point')
      .reduce((s, b) => s + b.choices.length, 0),
    0
  )
  // wordCount is the persisted per-block cache (see src/lib/wordCounts.ts);
  // summing it here avoids re-parsing every block's TipTap JSON per request.
  const wordCount = book.chapters.reduce((sum, c) =>
    sum + c.blocks.reduce((s, b) => s + b.wordCount, 0)
  , 0)

  return NextResponse.json({
    ...book,
    stats: { chapterCount, uniquePovs, choiceCount, wordCount },
  })
}

export async function PATCH(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const { title, order, synopsis, coverPath, published, inProgress } = await req.json()
  try {
    // A rename breaks every title-keyed consumer (canon-export folder
    // matching, WriteAI ingestion) until folders are renamed to match —
    // announce it so subscribers can react instead of silently drifting.
    const before = title !== undefined
      ? await prisma.book.findUnique({ where: { id: bookId }, select: { title: true } })
      : null
    // When marking a book as in-progress, atomically clear the flag on
    // every other book in the same series so there's never more than one
    // active. Toggling off is a plain single-row update.
    const book = inProgress === true
      ? await prisma.$transaction(async tx => {
          await tx.book.updateMany({
            where: { seriesId, NOT: { id: bookId } },
            data: { inProgress: false },
          })
          return tx.book.update({
            where: { id: bookId },
            data: {
              inProgress: true,
              ...(title !== undefined && { title }),
              ...(order !== undefined && { order }),
              ...(synopsis !== undefined && { synopsis }),
              ...(coverPath !== undefined && { coverPath }),
              ...(published !== undefined && { published }),
            },
          })
        })
      : await prisma.book.update({
          where: { id: bookId },
          data: {
            ...(title !== undefined && { title }),
            ...(order !== undefined && { order }),
            ...(synopsis !== undefined && { synopsis }),
            ...(coverPath !== undefined && { coverPath }),
            ...(published !== undefined && { published }),
            ...(inProgress === false && { inProgress: false }),
          },
        })
    if (before && before.title !== book.title) {
      await publishEvent('book.renamed', { seriesId, bookId, oldTitle: before.title, newTitle: book.title }).catch(() => {})
    }
    return NextResponse.json(book)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { bookId } = await params
  try {
    await prisma.book.delete({ where: { id: bookId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
