import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { blockWordCount } from '@/lib/wordCounts'

type Params = { params: Promise<{ blockId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { blockId } = await params
  const { content, prompt, displayType, baseContent, condition, pinStart, pinEnd, order } = await req.json()
  try {
    const block = await prisma.contentBlock.update({
      where: { id: blockId },
      data: {
        ...(content !== undefined && { content }),
        ...(prompt !== undefined && { prompt }),
        ...(displayType !== undefined && { displayType }),
        ...(baseContent !== undefined && { baseContent }),
        ...(condition !== undefined && { condition }),
        ...(pinStart !== undefined && { pinStart }),
        ...(pinEnd !== undefined && { pinEnd }),
        ...(order !== undefined && { order }),
      },
      include: {
        choices: { orderBy: { id: 'asc' } },
        overrides: { orderBy: { order: 'asc' } },
      },
    })
    // Prose changed → refresh the cached word count (the update above
    // returned the block with overrides, so everything needed is in hand).
    if (content !== undefined || baseContent !== undefined) {
      const wordCount = blockWordCount(block)
      if (wordCount !== block.wordCount) {
        await prisma.contentBlock.update({ where: { id: blockId }, data: { wordCount } })
        block.wordCount = wordCount
      }
    }
    return NextResponse.json(block)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { blockId } = await params
  try {
    await prisma.contentBlock.delete({ where: { id: blockId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
