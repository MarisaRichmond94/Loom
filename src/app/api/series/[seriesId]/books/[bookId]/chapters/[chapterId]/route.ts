import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { publishEvent } from '@/lib/eventBus'

type Params = { params: Promise<{ chapterId: string }> }

// See the matching helper in ../route.ts. Inlined here to avoid a
// shared-module import dance for two short functions.
function parseNumberedTitle(title: string): { prefix: string; num: number } | null {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return { prefix: '', num: Number(bare[1]) }
  const m = /^(.+\s)(\d+)$/.exec(title)
  if (m) return { prefix: m[1], num: Number(m[2]) }
  return null
}
function bumpTitleIfPrefixMatches(title: string, delta: number, matchPrefix: string): string {
  const parsed = parseNumberedTitle(title)
  if (!parsed || parsed.prefix !== matchPrefix) return title
  return `${parsed.prefix}${parsed.num + delta}`
}

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title, order, pov, date } = await req.json()
  try {
    const chapter = await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(title !== undefined && { title }),
        ...(order !== undefined && { order }),
        ...(pov !== undefined && { pov }),
        ...(date !== undefined && { date }),
      },
    })
    return NextResponse.json(chapter)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { chapterId } = await params
  try {
    const target = await prisma.chapter.findUnique({ where: { id: chapterId } })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const subsequent = await prisma.chapter.findMany({
      where: { bookId: target.bookId, order: { gt: target.order } },
    })
    // Same prefix-match rule the insert path uses: only renumber
    // siblings that share the deleted chapter's prefix.
    const targetParsed = parseNumberedTitle(target.title)
    const matchPrefix = targetParsed?.prefix ?? null

    await prisma.$transaction([
      prisma.chapter.delete({ where: { id: chapterId } }),
      ...subsequent.map(c => {
        const newTitle = matchPrefix !== null
          ? bumpTitleIfPrefixMatches(c.title, -1, matchPrefix)
          : c.title
        return prisma.chapter.update({
          where: { id: c.id },
          data: { order: c.order - 1, title: newTitle },
        })
      }),
    ])

    await publishEvent('chapter.deleted', { bookId: target.bookId, chapterId, title: target.title, order: target.order }).catch(() => {})
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
