import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCharacter } from '@/lib/resolveCharacter'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

// Returns the series' characters resolved for one book: hidden ones (first
// appearance set to a later book) are filtered out, and any per-book override
// row is merged onto the canonical fields. Used by the book page and the
// reader's per-book hover card.
export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true, order: true } })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  const [characters, overrides, firstBookRows] = await Promise.all([
    prisma.character.findMany({ where: { seriesId } }),
    prisma.characterBookOverride.findMany({ where: { bookId } }),
    prisma.book.findMany({ where: { seriesId }, select: { id: true, order: true } }),
  ])
  const orderByBookId = new Map(firstBookRows.map(b => [b.id, b.order]))
  const overrideByCharacterId = new Map(overrides.map(o => [o.characterId, o]))

  const resolved = characters.map(c =>
    resolveCharacter({
      character: { id: c.id, name: c.name, age: c.age, firstBookId: c.firstBookId },
      override: overrideByCharacterId.get(c.id) ?? null,
      book,
      firstBookOrder: c.firstBookId ? orderByBookId.get(c.firstBookId) ?? null : null,
    }),
  ).filter(r => r.visible)

  return NextResponse.json(resolved)
}
