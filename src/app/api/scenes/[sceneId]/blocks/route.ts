import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ sceneId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { sceneId } = await params
  const blocks = await prisma.contentBlock.findMany({
    where: { sceneId },
    orderBy: { order: 'asc' },
    include: {
      choices: { orderBy: { id: 'asc' } },
      overrides: { orderBy: { order: 'asc' } },
    },
  })
  return NextResponse.json(blocks)
}

export async function POST(req: Request, { params }: Params) {
  const { sceneId } = await params
  const { type, content, prompt, displayType, baseContent } = await req.json()
  if (!['text', 'choice_point', 'conditional_fragment'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }
  const count = await prisma.contentBlock.count({ where: { sceneId } })
  const block = await prisma.contentBlock.create({
    data: {
      sceneId,
      type,
      order: count + 1,
      ...(content !== undefined && { content }),
      ...(prompt !== undefined && { prompt }),
      ...(displayType !== undefined && { displayType }),
      ...(baseContent !== undefined && { baseContent }),
    },
  })
  return NextResponse.json(block, { status: 201 })
}
