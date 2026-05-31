import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeSeriesStats } from '@/lib/seriesStats'

export async function GET() {
  // Eager-load every book → chapter → block (with choices + overrides) so we
  // can compute series-level stats (books, POVs, words, choices) in one query
  // for the Write list cards. The list is local and small, so the read amp
  // is acceptable.
  const seriesList = await prisma.series.findMany({
    // Demo seed rows are reader-side only (Explore, AuthorModal, Continue
    // Reading). The Write list represents the author's own work, so hide
    // them here. Real series have demo:false by default.
    where: { demo: false },
    orderBy: { createdAt: 'desc' },
    include: {
      books: {
        include: {
          chapters: {
            include: {
              blocks: {
                include: { choices: true, overrides: true },
              },
            },
          },
        },
      },
    },
  })

  return NextResponse.json(seriesList.map(s => {
    const { books: _books, ...rest } = s
    return { ...rest, stats: computeSeriesStats(s.books) }
  }))
}

export async function POST(req: Request) {
  const { title, description = '', standalone = false } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const series = await prisma.series.create({
    data: { title: title.trim(), description, standalone: !!standalone },
  })
  // Stand-alone: the data model is still a Series-with-one-Book — auto-create
  // that book here so the author lands on a writeable page right away. The
  // book inherits the series title; the author can rename either later.
  let bookId: string | null = null
  if (standalone) {
    const book = await prisma.book.create({
      data: { seriesId: series.id, title: title.trim(), order: 1 },
    })
    bookId = book.id
  }
  return NextResponse.json({ ...series, bookId }, { status: 201 })
}
