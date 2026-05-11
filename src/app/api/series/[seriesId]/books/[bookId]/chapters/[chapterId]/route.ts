import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ chapterId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title, order } = await req.json()
  try {
    const chapter = await prisma.chapter.update({
      where: { id: chapterId },
      data: { ...(title !== undefined && { title }), ...(order !== undefined && { order }) },
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
    await prisma.chapter.delete({ where: { id: chapterId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
