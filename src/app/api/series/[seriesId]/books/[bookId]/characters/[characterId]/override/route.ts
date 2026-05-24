import { NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { characterAvatarPaths, resolveCharacter } from '@/lib/resolveCharacter'

type Params = { params: Promise<{ bookId: string; characterId: string }> }

// Upsert a (characterId, bookId) override row. Body: { age: number | null }.
// Returns the resolved character for the book so the UI can update in place.
export async function POST(req: Request, { params }: Params) {
  const { bookId, characterId } = await params
  const { age } = await req.json() as { age?: number | null }

  const [character, book] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.book.findUnique({ where: { id: bookId }, select: { id: true, seriesId: true, order: true } }),
  ])
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  const override = await prisma.characterBookOverride.upsert({
    where: { characterId_bookId: { characterId, bookId } },
    update: { age: age ?? null },
    create: { characterId, bookId, age: age ?? null },
  })

  let firstBookOrder: number | null = null
  if (character.firstBookId) {
    const firstBook = await prisma.book.findUnique({ where: { id: character.firstBookId }, select: { order: true } })
    firstBookOrder = firstBook?.order ?? null
  }
  let deathBookOrder: number | null = null
  if (character.deathBookId) {
    const deathBook = await prisma.book.findUnique({ where: { id: character.deathBookId }, select: { order: true } })
    deathBookOrder = deathBook?.order ?? null
  }

  return NextResponse.json(resolveCharacter({
    character: {
      id: character.id, name: character.name, age: character.age,
      firstBookId: character.firstBookId, deathBookId: character.deathBookId,
    },
    override,
    book: { id: book.id, order: book.order },
    firstBookOrder,
    deathBookOrder,
  }))
}

// Delete the override row entirely and remove any per-book avatar file.
// The book grid falls back to the canonical character after this.
export async function DELETE(_: Request, { params }: Params) {
  const { bookId, characterId } = await params
  try {
    await prisma.characterBookOverride.delete({
      where: { characterId_bookId: { characterId, bookId } },
    })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e
    // No override row existed — that's fine, we still want to clear any
    // stranded avatar file below.
  }

  const paths = characterAvatarPaths(characterId, bookId)
  await unlink(paths.bookSpecific).catch(() => null)

  return new NextResponse(null, { status: 204 })
}
