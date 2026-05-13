import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  await params
  const items: { id: string; order: number }[] = await req.json()
  await prisma.$transaction(
    items.map(({ id, order }) => prisma.contentBlock.update({ where: { id }, data: { order } }))
  )
  return NextResponse.json({ ok: true })
}
