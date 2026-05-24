import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const blocks = await prisma.contentBlock.findMany({
    where: { chapterId },
    orderBy: { order: 'asc' },
    include: {
      choices: { orderBy: { id: 'asc' } },
      overrides: { orderBy: { order: 'asc' } },
    },
  })
  // Tag soundtrack blocks with hasAlbumArt for the editor's thumbnail
  // affordance — file existence is the source of truth for the sidecar.
  const musicDir = path.join(process.cwd(), 'public', 'music')
  return NextResponse.json(blocks.map(b => b.type === 'soundtrack'
    ? { ...b, hasAlbumArt: existsSync(path.join(musicDir, `${b.id}-art.jpg`)) }
    : b))
}

export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { type, content, prompt, displayType, baseContent, insertAtOrder } = await req.json()
  if (!['text', 'choice_point', 'conditional_fragment', 'soundtrack'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  let order: number
  if (insertAtOrder != null) {
    await prisma.contentBlock.updateMany({
      where: { chapterId, order: { gte: insertAtOrder } },
      data: { order: { increment: 1 } },
    })
    order = insertAtOrder
  } else {
    const count = await prisma.contentBlock.count({ where: { chapterId } })
    order = count + 1
  }

  const block = await prisma.contentBlock.create({
    data: {
      chapterId,
      type,
      order,
      ...(content !== undefined && { content }),
      ...(prompt !== undefined && { prompt }),
      ...(displayType !== undefined && { displayType }),
      ...(baseContent !== undefined && { baseContent }),
    },
  })

  if (type === 'choice_point') {
    await prisma.choice.createMany({
      data: [
        { choicePointId: block.id, label: 'Yes', setsVariables: '{}' },
        { choicePointId: block.id, label: 'No',  setsVariables: '{}' },
      ],
    })
  }

  const blockWithRelations = await prisma.contentBlock.findUnique({
    where: { id: block.id },
    include: { choices: { orderBy: { id: 'asc' } }, overrides: { orderBy: { order: 'asc' } } },
  })
  return NextResponse.json(blockWithRelations, { status: 201 })
}
