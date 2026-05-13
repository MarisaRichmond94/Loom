import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  const currentBook = await prisma.book.findUnique({ where: { id: bookId } })
  if (!currentBook) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const books = await prisma.book.findMany({
    where: { seriesId, order: { lte: currentBook.order } },
    orderBy: { order: 'asc' },
    include: {
      chapters: {
        orderBy: { order: 'asc' },
        include: {
          blocks: {
            where: { type: 'choice_point', prompt: { not: null } },
            select: { id: true, prompt: true, chapterId: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  })

  const questions = books.flatMap(book =>
    book.chapters.flatMap(chapter =>
      chapter.blocks.map(block => ({
        id: block.id,
        prompt: block.prompt!,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        bookTitle: book.title,
      }))
    )
  )

  return NextResponse.json(questions)
}
