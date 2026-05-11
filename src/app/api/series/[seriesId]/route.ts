import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      books: {
        orderBy: { order: 'asc' },
        include: {
          chapters: {
            orderBy: { order: 'asc' },
            include: { scenes: { orderBy: { order: 'asc' } } },
          },
        },
      },
      variables: { orderBy: { name: 'asc' } },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(series)
}

export async function PATCH(req: Request, { params }: Params) {
  const { seriesId } = await params
  const data = await req.json()
  const series = await prisma.series.update({ where: { id: seriesId }, data })
  return NextResponse.json(series)
}

export async function DELETE(_: Request, { params }: Params) {
  const { seriesId } = await params
  await prisma.series.delete({ where: { id: seriesId } })
  return new NextResponse(null, { status: 204 })
}
