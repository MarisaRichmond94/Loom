import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const data = await req.json()
  const chapter = await prisma.chapter.update({ where: { id: chapterId }, data })
  return NextResponse.json(chapter)
}

export async function DELETE(_: Request, { params }: Params) {
  const { chapterId } = await params
  await prisma.chapter.delete({ where: { id: chapterId } })
  return new NextResponse(null, { status: 204 })
}
