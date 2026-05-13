import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

function bumpTitle(title: string, delta: number): string {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return String(Number(bare[1]) + delta)
  const named = /^(Chapter )(\d+)$/i.exec(title)
  if (named) return `${named[1]}${Number(named[2]) + delta}`
  return title
}

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const { title, insertAtOrder } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

  if (insertAtOrder == null) {
    const count = await prisma.chapter.count({ where: { bookId } })
    const chapter = await prisma.chapter.create({
      data: { bookId, title: title.trim(), order: count + 1 },
    })
    return NextResponse.json(chapter, { status: 201 })
  }

  const existing = await prisma.chapter.findMany({ where: { bookId }, orderBy: { order: 'asc' } })
  const toShift = existing.filter(c => c.order >= insertAtOrder)

  const chapter = await prisma.$transaction(async tx => {
    for (const c of toShift) {
      await tx.chapter.update({
        where: { id: c.id },
        data: { order: c.order + 1, title: bumpTitle(c.title, 1) },
      })
    }
    return tx.chapter.create({
      data: { bookId, title: title.trim(), order: insertAtOrder },
    })
  })

  return NextResponse.json(chapter, { status: 201 })
}
