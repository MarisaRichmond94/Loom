import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ chapterId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      blocks: {
        orderBy: { order: 'asc' },
        include: {
          choices: { orderBy: { id: 'asc' } },
          overrides: { orderBy: { order: 'asc' } },
        },
      },
    },
  })
  if (!chapter) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Mark which soundtrack blocks have an uploaded album-art sidecar so the
  // editor + reader can render the thumbnail. File existence is the source
  // of truth; same pattern as character avatars.
  const musicDir = path.join(process.cwd(), 'public', 'music')
  const blocks = chapter.blocks.map(b => b.type === 'soundtrack'
    ? { ...b, hasAlbumArt: existsSync(path.join(musicDir, `${b.id}-art.jpg`)) }
    : b)
  return NextResponse.json({ ...chapter, blocks })
}

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title, pov, date, condition, numbered } = await req.json()
  try {
    const chapter = await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(title !== undefined && { title }),
        ...(pov !== undefined && { pov }),
        ...(date !== undefined && { date }),
        ...(condition !== undefined && { condition }),
        ...(numbered !== undefined && { numbered }),
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
