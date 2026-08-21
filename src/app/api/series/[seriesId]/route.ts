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
            // Note bodies are short scratchpad text, so selecting them here to
            // compute hasNotes (never shipped to the client) doesn't reintroduce
            // the bulk-payload cost ChapterNote's separate table avoids.
            //
            // blocks: only wordCount (an already-maintained cache column, see
            // src/lib/wordCounts.ts) and a choices COUNT — no content, no
            // choice rows — so the series page can derive chapter/word/POV/
            // choice stats from this one load instead of a per-book deep
            // fetch (see AuthorSeriesPage).
            include: {
              note: { select: { body: true } },
              blocks: { select: { wordCount: true, _count: { select: { choices: true } } } },
            },
          },
        },
      },
      // Order by id (cuid is timestamp-prefixed) so newer variables appear last —
      // helps the writer locate recently-added context in dropdowns.
      variables: { orderBy: { id: 'asc' } },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const withHasNotes = {
    ...series,
    books: series.books.map(book => ({
      ...book,
      chapters: book.chapters.map(({ note, ...chapter }) => ({ ...chapter, hasNotes: !!note?.body.trim() })),
    })),
  }
  return NextResponse.json(withHasNotes)
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
