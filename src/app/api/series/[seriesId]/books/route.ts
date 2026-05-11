import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const books = await prisma.book.findMany({
    where: { seriesId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(books)
}

export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  const { title } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const count = await prisma.book.count({ where: { seriesId } })
  const book = await prisma.book.create({
    data: { seriesId, title: title.trim(), order: count + 1 },
  })
  return NextResponse.json(book, { status: 201 })
}
