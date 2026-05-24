import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

// Lightweight, series-agnostic book lookup used by the public preview
// landing page (which knows only the bookId from its URL). Returns just
// what the landing needs — metadata + chapter titles — without pulling
// the full block payload the author endpoint at
// /api/series/[seriesId]/books/[bookId] does.
export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true },
      },
    },
  })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(book)
}
