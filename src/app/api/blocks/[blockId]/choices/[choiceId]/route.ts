import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ choiceId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { choiceId } = await params
  const { label, setsVariables, targetChapterId, endingMessage, isBadEnding, condition } = await req.json()
  try {
    // A condition may only be attached to a gate-eligible extra option
    // (order >= 2). The two base options always render, so gating one
    // would defeat the guarantee that every choice point offers a path.
    if (condition !== undefined) {
      const existing = await prisma.choice.findUnique({
        where: { id: choiceId },
        select: { order: true },
      })
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (existing.order < 2 && condition != null && condition !== '{}' && condition !== '') {
        return NextResponse.json({ error: 'The two base options cannot be gated.' }, { status: 400 })
      }
    }
    const choice = await prisma.choice.update({
      where: { id: choiceId },
      data: {
        ...(label !== undefined && { label }),
        ...(setsVariables !== undefined && { setsVariables }),
        ...(targetChapterId !== undefined && { targetChapterId }),
        ...(endingMessage !== undefined && { endingMessage }),
        ...(isBadEnding !== undefined && { isBadEnding }),
        ...(condition !== undefined && { condition }),
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
    // Protect the two base options (order 0/1) — deleting into the base
    // pair would leave a choice point with fewer than two always-visible
    // paths. Only extras (order >= 2) are removable.
    const existing = await prisma.choice.findUnique({
      where: { id: choiceId },
      select: { order: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.order < 2) {
      return NextResponse.json({ error: 'The two base options cannot be deleted.' }, { status: 400 })
    }
    await prisma.choice.delete({ where: { id: choiceId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
