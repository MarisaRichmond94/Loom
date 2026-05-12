import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ blockId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { blockId } = await params
  try {
    const block = await prisma.contentBlock.findUnique({ where: { id: blockId } })
    if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(block)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
