import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ overrideId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { overrideId } = await params
  const { condition, content, order } = await req.json()
  try {
    const override = await prisma.conditionalOverride.update({
      where: { id: overrideId },
      data: {
        ...(condition !== undefined && { condition }),
        ...(content !== undefined && { content }),
        ...(order !== undefined && { order }),
      },
    })
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
    await prisma.conditionalOverride.delete({ where: { id: overrideId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
