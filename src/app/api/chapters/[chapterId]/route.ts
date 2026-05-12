import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      blocks: {
        orderBy: { order: 'asc' },
        include: {
          choices: { orderBy: { id: 'asc' } },
          overrides: { orderBy: { order: 'asc' } },
        },
      },
    },
  })
  if (!chapter) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(chapter)
}
