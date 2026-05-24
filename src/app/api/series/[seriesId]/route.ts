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
          },
        },
      },
      // Order by id (cuid is timestamp-prefixed) so newer variables appear last —
      // helps the writer locate recently-added context in dropdowns.
      variables: { orderBy: { id: 'asc' } },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(series)
}

export async function PATCH(req: Request, { params }: Params) {
  const { seriesId } = await params
  const { title, description, genres, keywords } = await req.json()
  try {
    const series = await prisma.series.update({
      where: { id: seriesId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        // genres/keywords come in as arrays from the client and are stored as
        // JSON strings (SQLite has no native list type). Defensive: only
        // serialize when the value is actually an array, otherwise pass
        // through (lets callers send a pre-serialized string if they want).
        ...(genres !== undefined && { genres: Array.isArray(genres) ? JSON.stringify(genres) : genres }),
        ...(keywords !== undefined && { keywords: Array.isArray(keywords) ? JSON.stringify(keywords) : keywords }),
      },
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
