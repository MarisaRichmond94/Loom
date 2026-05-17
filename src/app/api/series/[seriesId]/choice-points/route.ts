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
    bookTitle: string
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
          bookTitle: book.title,
          choices: block.choices.map(c => ({
            id: c.id,
            label: c.label,
            setsVariables: c.setsVariables,
          })),
        })
      }
    }
  }

  return NextResponse.json(choicePoints)
}
