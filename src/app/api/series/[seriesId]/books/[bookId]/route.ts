import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateDivergence } from '@/lib/bookDivergence'
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
  const { title, order, synopsis, coverPath, published, inProgress, canon, condition, divergesFromBookId } = await req.json()
  // `divergesFromBookId` has no foreign key (see the schema comment), so what
  // an FK would refuse is refused here instead (LOOM-152). The rules live in
  // lib/bookDivergence.ts, pure and unit-tested — every one of them fails
  // silently if allowed through.
  if (divergesFromBookId) {
    const parent = await prisma.book.findUnique({
      where: { id: divergesFromBookId },
      select: { seriesId: true, canon: true },
    })
    const invalid = validateDivergence({ bookId, seriesId, divergesFromBookId, parent })
    if (invalid) return NextResponse.json(invalid, { status: 400 })
  }

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
              ...(canon !== undefined && { canon }),
              // `!== undefined`, not truthiness: null is how the dialog CLEARS
              // a gate, and a truthy check would silently ignore it.
              ...(condition !== undefined && { condition }),
              ...(divergesFromBookId !== undefined && { divergesFromBookId }),
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
            ...(canon !== undefined && { canon }),
            ...(condition !== undefined && { condition }),
            ...(divergesFromBookId !== undefined && { divergesFromBookId }),
            // A canon book sits at its own order and has no divergence by
            // definition. Leaving a stale pointer behind would be invisible
            // until the book was made non-canon again, at which point it would
            // silently adopt an old branch point.
            ...(canon === true && { divergesFromBookId: null }),
            ...(inProgress === false && { inProgress: false }),
          },
        })
    // Books that branched off THIS one can no longer do so — a divergence must
    // leave from the canon line. Cleared rather than blocked: the writer is
    // reclassifying a book, not editing its children, and the empty
    // "Diverges from…" control says so loudly on each affected card.
    if (canon === false) {
      await prisma.book.updateMany({
        where: { seriesId, divergesFromBookId: bookId },
        data: { divergesFromBookId: null },
      })
    }
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
    // `Book.divergesFromBookId` is a plain String, not a relation — adding a
    // foreign key to Book would mean rebuilding a table that holds the whole
    // manuscript (see the schema comment). So the SetNull an FK would have
    // given us happens here, explicitly, in the same transaction as the delete.
    //
    // Without it, deleting a canon book leaves any alt book that branched off
    // it pointing at nothing — which reads as "divergence unrecorded", and
    // silently switches that book's character rules to their no-information
    // answers. A visible cleanup beats an invisible dangling id.
    await prisma.$transaction([
      prisma.book.updateMany({
        where: { divergesFromBookId: bookId },
        data: { divergesFromBookId: null },
      }),
      prisma.book.delete({ where: { id: bookId } }),
    ])
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
