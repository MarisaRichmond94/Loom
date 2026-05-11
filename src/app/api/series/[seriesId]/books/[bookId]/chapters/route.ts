import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const { title } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const count = await prisma.chapter.count({ where: { bookId } })
  const chapter = await prisma.chapter.create({
    data: { bookId, title: title.trim(), order: count + 1 },
  })
  return NextResponse.json(chapter, { status: 201 })
}
