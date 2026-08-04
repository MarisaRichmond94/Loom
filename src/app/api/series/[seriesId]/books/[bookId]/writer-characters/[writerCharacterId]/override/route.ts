import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { isSafeCharacterId } from '@/lib/writerCharacters'
import { validateWriterCharacterMetaPatch } from '@/lib/writerCharacterMeta'
import { resolveOneWriterCharacterForBook } from '@/lib/writerCharacterBook'

type Params = { params: Promise<{ seriesId: string; bookId: string; writerCharacterId: string }> }

// A writer character's per-book overlay — LOOM-88, under LOOM-5. Successor to
// the CharacterBookOverride route.
//
// Currently age only. The per-book PORTRAIT is a file, handled by the sibling
// avatar route.

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId, writerCharacterId } = await params
  if (!isSafeCharacterId(writerCharacterId)) {
    return NextResponse.json({ error: 'invalid character id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // Reuses the overlay validator, then takes only `age` from it — the rest of
  // those fields are series-level and would be meaningless per book.
  const validated = validateWriterCharacterMetaPatch(body)
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })
  if (!('age' in validated.patch)) {
    return NextResponse.json({ error: 'age is the only per-book field' }, { status: 400 })
  }

  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  // The per-book row hangs off the series overlay row, so setting a per-book
  // age for a character Loom knows nothing about creates the parent first.
  // That row is empty — it asserts nothing about the character beyond "this
  // book has an age for them".
  const meta = await prisma.writerCharacterMeta.upsert({
    where: { seriesId_writerCharacterId: { seriesId, writerCharacterId } },
    update: {},
    create: { seriesId, writerCharacterId },
  })

  await prisma.writerCharacterBookMeta.upsert({
    where: { metaId_bookId: { metaId: meta.id, bookId } },
    update: { age: validated.patch.age ?? null },
    create: { metaId: meta.id, bookId, age: validated.patch.age ?? null },
  })

  const resolved = await resolveOneWriterCharacterForBook(bookId, writerCharacterId)
  // Null means WriteAI has no such character — the overlay row is written and
  // harmless, but there is nothing to render, so say so rather than returning
  // a half-empty object.
  if (!resolved) {
    return NextResponse.json({ error: 'character is not in the snapshot' }, { status: 404 })
  }
  return NextResponse.json(resolved)
}

// Reset this book to the series default. Absent is success — see the series
// overlay route for why.
export async function DELETE(_: Request, { params }: Params) {
  const { seriesId, bookId, writerCharacterId } = await params
  const meta = await prisma.writerCharacterMeta.findUnique({
    where: { seriesId_writerCharacterId: { seriesId, writerCharacterId } },
    select: { id: true },
  })
  if (meta) {
    try {
      await prisma.writerCharacterBookMeta.delete({
        where: { metaId_bookId: { metaId: meta.id, bookId } },
      })
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e
    }
  }
  return new NextResponse(null, { status: 204 })
}
