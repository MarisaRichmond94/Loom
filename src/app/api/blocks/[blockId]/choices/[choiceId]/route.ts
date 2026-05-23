import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ choiceId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { choiceId } = await params
  const { label, setsVariables, targetChapterId, endingMessage } = await req.json()
  try {
    const choice = await prisma.choice.update({
      where: { id: choiceId },
      data: {
        ...(label !== undefined && { label }),
        ...(setsVariables !== undefined && { setsVariables }),
        ...(targetChapterId !== undefined && { targetChapterId }),
        ...(endingMessage !== undefined && { endingMessage }),
      },
    })
    return NextResponse.json(choice)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { choiceId } = await params
  try {
    await prisma.choice.delete({ where: { id: choiceId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
