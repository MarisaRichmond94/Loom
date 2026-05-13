import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ chapterId: string }> }

function bumpTitle(title: string, delta: number): string {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return String(Number(bare[1]) + delta)
  const named = /^(Chapter )(\d+)$/i.exec(title)
  if (named) return `${named[1]}${Number(named[2]) + delta}`
  return title
}

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title, order, pov, date } = await req.json()
  try {
    const chapter = await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(title !== undefined && { title }),
        ...(order !== undefined && { order }),
        ...(pov !== undefined && { pov }),
        ...(date !== undefined && { date }),
      },
    })
    return NextResponse.json(chapter)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { chapterId } = await params
  try {
    const target = await prisma.chapter.findUnique({ where: { id: chapterId } })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const subsequent = await prisma.chapter.findMany({
      where: { bookId: target.bookId, order: { gt: target.order } },
    })

    await prisma.$transaction([
      prisma.chapter.delete({ where: { id: chapterId } }),
      ...subsequent.map(c =>
        prisma.chapter.update({
          where: { id: c.id },
          data: { order: c.order - 1, title: bumpTitle(c.title, -1) },
        })
      ),
    ])

    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
