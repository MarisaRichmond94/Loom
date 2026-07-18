import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ blockId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const { label = '', setsVariables = {}, targetChapterId = null, condition = null } = await req.json()
  // Append after the existing options. The two base options (orders 0 and 1)
  // are seeded when the choice point is created; anything added here is a
  // gate-eligible extra, so it lands at max(order)+1 (>= 2). An empty label
  // is allowed — the writer fills it in inline like the base slots.
  const last = await prisma.choice.findFirst({
    where: { choicePointId: blockId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const choice = await prisma.choice.create({
    data: {
      choicePointId: blockId,
      order: (last?.order ?? -1) + 1,
      label: typeof label === 'string' ? label.trim() : '',
      setsVariables: JSON.stringify(setsVariables),
      condition,
      targetChapterId,
    },
  })
  return NextResponse.json(choice, { status: 201 })
}
