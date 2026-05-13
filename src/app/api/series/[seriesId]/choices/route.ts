import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { seriesId } = await params
  const { searchParams } = req.nextUrl
  const upToBookId = searchParams.get('upToBookId')
  const upToChapterId = searchParams.get('upToChapterId')

  let bookOrderLimit: number | undefined
  let chapterOrderLimit: number | undefined
  let limitedBookId: string | undefined

  if (upToChapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: upToChapterId },
      include: { book: true },
    })
    if (!chapter) return NextResponse.json([])
    bookOrderLimit = chapter.book.order
    chapterOrderLimit = chapter.order
    limitedBookId = chapter.bookId
  } else if (upToBookId) {
    const book = await prisma.book.findUnique({ where: { id: upToBookId } })
    if (!book) return NextResponse.json([])
    bookOrderLimit = book.order
  }

  const books = await prisma.book.findMany({
    where: {
      seriesId,
      ...(bookOrderLimit !== undefined ? { order: { lte: bookOrderLimit } } : {}),
    },
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

  const questions: { id: string; prompt: string; chapterId: string; chapterTitle: string; bookTitle: string }[] = []

  for (const book of books) {
    for (const chapter of book.chapters) {
      if (chapterOrderLimit !== undefined && book.id === limitedBookId && chapter.order > chapterOrderLimit) continue
      for (const block of chapter.blocks) {
        questions.push({
          id: block.id,
          prompt: block.prompt!,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          bookTitle: book.title,
        })
      }
    }
  }

  return NextResponse.json(questions)
}
