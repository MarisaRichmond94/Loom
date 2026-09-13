import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateDivergence } from '@/lib/bookDivergence'

type Params = { params: Promise<{ seriesId: string }> }

/**
 * Where a NON-CANON book's order starts (LOOM-156).
 *
 * Alt books sort beneath every canon book, and the author list enforces that in
 * its sort — but `Book.order` should not quietly collide either, because every
 * ordinal rule over books reads it (see LOOM-147). Handing alt books their own
 * high range means a canon book added later can never land on the same number
 * as an existing alt one, without anything having to renumber anything.
 */
const ALT_ORDER_BASE = 1000

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const books = await prisma.book.findMany({
    where: { seriesId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(books)
}

export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  const body = await req.json() as {
    title?: string
    synopsis?: string
    published?: boolean
    inProgress?: boolean
    canon?: boolean
    condition?: string | null
    divergesFromBookId?: string | null
  }
  const title = body.title
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

  // Default true, matching the column: a book is canon unless said otherwise.
  const canon = body.canon !== false

  // Same rules the PATCH enforces, from the same module — a divergence set at
  // creation is exactly as able to be wrong as one set later.
  if (body.divergesFromBookId) {
    const parent = await prisma.book.findUnique({
      where: { id: body.divergesFromBookId },
      select: { seriesId: true, canon: true },
    })
    const invalid = validateDivergence({
      // No id yet, and a book cannot diverge from itself anyway — '' can never
      // equal a real cuid, so the self-check simply passes.
      bookId: '',
      seriesId,
      divergesFromBookId: body.divergesFromBookId,
      parent,
    })
    if (invalid) return NextResponse.json(invalid, { status: 400 })
  }

  const siblings = await prisma.book.findMany({
    where: { seriesId },
    select: { order: true, canon: true },
  })
  const maxOf = (rows: { order: number }[], floor: number) =>
    rows.reduce((n, b) => Math.max(n, b.order), floor)
  const order = canon
    ? maxOf(siblings.filter(b => b.canon), 0) + 1
    : maxOf(siblings.filter(b => !b.canon), ALT_ORDER_BASE - 1) + 1

  const book = await prisma.book.create({
    data: {
      seriesId,
      title: title.trim(),
      order,
      synopsis: body.synopsis?.trim() ?? '',
      published: body.published === true,
      canon,
      // A canon book has no divergence by definition — the PATCH clears one for
      // the same reason, and accepting it here would create the stale pointer
      // that clearing exists to prevent.
      condition: body.condition?.trim() || null,
      divergesFromBookId: canon ? null : (body.divergesFromBookId ?? null),
    },
  })

  // In-progress is exclusive across the series, so it goes through the same
  // clear-everything-else step the PATCH uses rather than being set inline.
  if (body.inProgress === true) {
    await prisma.$transaction([
      prisma.book.updateMany({
        where: { seriesId, NOT: { id: book.id } },
        data: { inProgress: false },
      }),
      prisma.book.update({ where: { id: book.id }, data: { inProgress: true } }),
    ])
    return NextResponse.json({ ...book, inProgress: true }, { status: 201 })
  }

  return NextResponse.json(book, { status: 201 })
}
