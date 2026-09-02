import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { publicDirFilenames } from '@/lib/publicAssets'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const rows = await prisma.contentBlock.findMany({
    where: {
      type: 'soundtrack',
      content: { not: null },
      chapter: { book: { seriesId } },
    },
    include: {
      chapter: { select: { id: true, title: true, order: true, book: { select: { id: true, title: true, order: true } } } },
    },
    orderBy: [
      { chapter: { book: { order: 'asc' } } },
      { chapter: { order: 'asc' } },
      { order: 'asc' },
    ],
  })

  const musicFiles = await publicDirFilenames('music')
  return NextResponse.json(rows.map(b => ({
    id: b.id,
    title: b.prompt,
    audioPath: b.content,
    pinStart: b.pinStart,
    pinEnd: b.pinEnd,
    chapterId: b.chapter.id,
    chapterTitle: b.chapter.title,
    chapterOrder: b.chapter.order,
    bookId: b.chapter.book.id,
    bookTitle: b.chapter.book.title,
    bookOrder: b.chapter.book.order,
    hasAlbumArt: musicFiles.has(`${b.id}-art.jpg`),
  })))
}
