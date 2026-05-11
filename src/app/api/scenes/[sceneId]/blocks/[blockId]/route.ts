import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ blockId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { blockId } = await params
  const { content, prompt, displayType, baseContent, order } = await req.json()
  try {
    const block = await prisma.contentBlock.update({
      where: { id: blockId },
      data: {
        ...(content !== undefined && { content }),
        ...(prompt !== undefined && { prompt }),
        ...(displayType !== undefined && { displayType }),
        ...(baseContent !== undefined && { baseContent }),
        ...(order !== undefined && { order }),
      },
      include: {
        choices: { orderBy: { id: 'asc' } },
        overrides: { orderBy: { order: 'asc' } },
      },
    })
    return NextResponse.json(block)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { blockId } = await params
  try {
    await prisma.contentBlock.delete({ where: { id: blockId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
