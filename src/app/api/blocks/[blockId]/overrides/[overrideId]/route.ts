import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { refreshBlockWordCounts } from '@/lib/wordCounts'

type Params = { params: Promise<{ overrideId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { overrideId } = await params
  const { condition, content, order, endingMessage, endsChapter } = await req.json()
  try {
    const override = await prisma.conditionalOverride.update({
      where: { id: overrideId },
      data: {
        ...(condition !== undefined && { condition }),
        ...(content !== undefined && { content }),
        ...(order !== undefined && { order }),
        ...(endingMessage !== undefined && { endingMessage }),
        ...(endsChapter !== undefined && { endsChapter }),
      },
    })
    if (content !== undefined) await refreshBlockWordCounts([override.conditionalFragmentId])
    return NextResponse.json(override)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { overrideId } = await params
  try {
    const deleted = await prisma.conditionalOverride.delete({ where: { id: overrideId } })
    await refreshBlockWordCounts([deleted.conditionalFragmentId])
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
