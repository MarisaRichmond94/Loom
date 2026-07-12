import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params

  const books = await prisma.book.findMany({
    where: { seriesId },
    orderBy: { order: 'asc' },
    include: {
      chapters: {
        orderBy: { order: 'asc' },
        include: {
          blocks: {
            where: { type: 'choice_point', prompt: { not: null } },
            orderBy: { order: 'asc' },
            include: {
              choices: { orderBy: { id: 'asc' } },
            },
          },
        },
      },
    },
  })

  const choicePoints: {
    id: string
    prompt: string
    chapterId: string
    chapterTitle: string
    chapterOrder: number
    chapterCondition: string | null
    chapterNumbered: boolean
    bookTitle: string
    bookOrder: number
    choices: { id: string; label: string; setsVariables: string }[]
  }[] = []

  for (const book of books) {
    for (const chapter of book.chapters) {
      for (const block of chapter.blocks) {
        choicePoints.push({
          id: block.id,
          prompt: block.prompt!,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterOrder: chapter.order,
          chapterCondition: chapter.condition,
          chapterNumbered: chapter.numbered,
          bookTitle: book.title,
          bookOrder: book.order,
          choices: block.choices.map(c => ({
            id: c.id,
            label: c.label,
            setsVariables: c.setsVariables,
          })),
        })
      }
    }
  }

  // Full-series walk used by the bad-ending rewind picker; cache briefly so
  // repeated bad endings in one sitting don't re-walk the series each time.
  return NextResponse.json(choicePoints, { headers: { 'Cache-Control': 'private, max-age=15' } })
}
