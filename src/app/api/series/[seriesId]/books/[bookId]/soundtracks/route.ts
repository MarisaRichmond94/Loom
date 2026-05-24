import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  const rows = await prisma.contentBlock.findMany({
    where: {
      type: 'soundtrack',
      content: { not: null },
      chapter: { bookId },
    },
    include: {
      chapter: { select: { id: true, title: true, order: true } },
    },
    orderBy: [
      { chapter: { order: 'asc' } },
      { order: 'asc' },
    ],
  })

  return NextResponse.json(rows.map(b => ({
    id: b.id,
    title: b.prompt,
    audioPath: b.content,
    pinStart: b.pinStart,
    pinEnd: b.pinEnd,
    chapterId: b.chapter.id,
    chapterTitle: b.chapter.title,
    chapterOrder: b.chapter.order,
  })))
}
