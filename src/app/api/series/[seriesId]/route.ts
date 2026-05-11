import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

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
  const { title, description } = await req.json()
  try {
    const series = await prisma.series.update({
      where: { id: seriesId },
      data: { ...(title !== undefined && { title }), ...(description !== undefined && { description }) },
    })
    return NextResponse.json(series)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { seriesId } = await params
  try {
    await prisma.series.delete({ where: { id: seriesId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
