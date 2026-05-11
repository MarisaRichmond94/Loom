import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ blockId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const { label, setsVariables = {}, targetSceneId = null } = await req.json()
  if (!label?.trim()) return NextResponse.json({ error: 'label required' }, { status: 400 })
  const choice = await prisma.choice.create({
    data: {
      choicePointId: blockId,
      label: label.trim(),
      setsVariables: JSON.stringify(setsVariables),
      targetSceneId,
    },
  })
  return NextResponse.json(choice, { status: 201 })
}
