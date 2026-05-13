import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

function setTitle(title: string, order: number): string {
  if (/^\d+$/.test(title)) return String(order)
  const m = /^(Chapter )(\d+)$/i.exec(title)
  if (m) return `${m[1]}${order}`
  return title
}

export async function PATCH(req: Request, { params }: Params) {
  await params
  const items: { id: string; order: number }[] = await req.json()
  const existing = await prisma.chapter.findMany({
    where: { id: { in: items.map(i => i.id) } },
    select: { id: true, title: true },
  })
  const titleById = Object.fromEntries(existing.map(c => [c.id, c.title]))
  await prisma.$transaction(
    items.map(({ id, order }) =>
      prisma.chapter.update({
        where: { id },
        data: { order, title: setTitle(titleById[id] ?? '', order) },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
