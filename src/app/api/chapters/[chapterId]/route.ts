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

// "<prefix> <number>" detector, same shape as the insert/delete routes.
// Bare numbers ("14"), canonical "Chapter 14", and any author-coined
// prefix like "Bonus Chapter 1" / "Interlude 3" all parse.
function parseNumberedTitle(title: string): { prefix: string; num: number } | null {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return { prefix: '', num: Number(bare[1]) }
  const m = /^(.+\s)(\d+)$/.exec(title)
  if (m) return { prefix: m[1], num: Number(m[2]) }
  return null
}

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title, pov, date, condition, numbered } = await req.json()

  // Renaming a chapter is treated as removal from the old prefix series
  // AND insertion into the new prefix series. When the prefixes differ:
  //   - old prefix: decrement every "<oldPrefix> N" sibling whose number
  //     is greater than the old number (closes the gap left behind)
  //   - new prefix: increment every "<newPrefix> N" sibling whose number
  //     is >= the new number (makes room for the renamed chapter)
  // Same-prefix renames are left alone — the writer is editing within
  // one series and may want to fix a typo without cascading.
  let renameBumps: { id: string; title: string }[] = []
  if (typeof title === 'string') {
    const current = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { bookId: true, title: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const oldParsed = parseNumberedTitle(current.title)
    const newParsed = parseNumberedTitle(title)
    const samePrefix = oldParsed && newParsed && oldParsed.prefix === newParsed.prefix
    if (!samePrefix) {
      const siblings = await prisma.chapter.findMany({
        where: { bookId: current.bookId, id: { not: chapterId } },
        select: { id: true, title: true },
      })
      for (const sib of siblings) {
        const parsed = parseNumberedTitle(sib.title)
        if (!parsed) continue
        // Decrement old-prefix siblings above the vacated slot
        if (oldParsed && parsed.prefix === oldParsed.prefix && parsed.num > oldParsed.num) {
          renameBumps.push({ id: sib.id, title: `${parsed.prefix}${parsed.num - 1}` })
          continue
        }
        // Increment new-prefix siblings at or above the new slot
        if (newParsed && parsed.prefix === newParsed.prefix && parsed.num >= newParsed.num) {
          renameBumps.push({ id: sib.id, title: `${parsed.prefix}${parsed.num + 1}` })
        }
      }
    }
  }

  try {
    const chapter = await prisma.$transaction(async tx => {
      for (const bump of renameBumps) {
        await tx.chapter.update({ where: { id: bump.id }, data: { title: bump.title } })
      }
      return tx.chapter.update({
        where: { id: chapterId },
        data: {
          ...(title !== undefined && { title }),
          ...(pov !== undefined && { pov }),
          ...(date !== undefined && { date }),
          ...(condition !== undefined && { condition }),
          ...(numbered !== undefined && { numbered }),
        },
      })
    })
    return NextResponse.json(chapter)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
