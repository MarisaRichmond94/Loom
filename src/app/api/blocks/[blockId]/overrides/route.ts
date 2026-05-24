import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ blockId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const { condition = {}, content, endingMessage } = await req.json()
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })
  const count = await prisma.conditionalOverride.count({
    where: { conditionalFragmentId: blockId },
  })
  const override = await prisma.conditionalOverride.create({
    data: {
      conditionalFragmentId: blockId,
      order: count + 1,
      condition: JSON.stringify(condition),
      content,
      endingMessage: endingMessage ?? null,
    },
  })
  return NextResponse.json(override, { status: 201 })
}
