import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { isSafeCharacterId } from '@/lib/writerCharacters'
import { validateWriterCharacterMetaPatch } from '@/lib/writerCharacterMeta'

type Params = { params: Promise<{ seriesId: string; writerCharacterId: string }> }

// Loom's overlay on a writer character — LOOM-88, under LOOM-5.
//
// ⚠️ This route writes LOOM's fields only: age, starred, first/death/last
// book. Name, category, aliases, traits, goals, arc notes and relationships
// belong to WriteAI and are edited in the dock's CharacterModal. Do not add
// them here — two editable homes for one field means one of them is a lie, and
// WriteAI's PUT stores bodies verbatim, so the loser loses data rather than
// just an argument.

export async function PATCH(req: Request, { params }: Params) {
  const { seriesId, writerCharacterId } = await params
  if (!isSafeCharacterId(writerCharacterId)) {
    return NextResponse.json({ error: 'invalid character id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const validated = validateWriterCharacterMetaPatch(body)
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })

  // Upsert, because an overlay row only exists once someone has said something
  // about the character. Editing a field on a character Loom has never been
  // told anything about is a create, not a 404.
  const meta = await prisma.writerCharacterMeta.upsert({
    where: { seriesId_writerCharacterId: { seriesId, writerCharacterId } },
    update: validated.patch,
    create: { seriesId, writerCharacterId, ...validated.patch },
  })

  return NextResponse.json(meta)
}

// Remove Loom's overlay — and ONLY Loom's overlay.
//
// The character itself survives in WriteAI, keeps their traits, relationships
// and chapter tags, and still appears in the cast (un-aged, unstarred, visible
// in every book) because a character with no overlay row is treated as one
// Loom has not been told anything about.
//
// Deleting the WriteAI record is a different, much larger act — it would strip
// the character out of every writer-event that names them and out of canon
// lookup — and it deliberately lives only in the dock, where that consequence
// is visible.
//
// Per-book portrait FILES are left alone: they are removed through the avatar
// route's DELETE, which is the control that says "use the default portrait".
export async function DELETE(_: Request, { params }: Params) {
  const { seriesId, writerCharacterId } = await params
  try {
    // WriterCharacterBookMeta rows cascade — they hang off this row precisely
    // so they cannot outlive it.
    await prisma.writerCharacterMeta.delete({
      where: { seriesId_writerCharacterId: { seriesId, writerCharacterId } },
    })
  } catch (e) {
    // Nothing to remove is a success, not a 404: the end state the caller
    // asked for is the end state they got.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e
  }
  return new NextResponse(null, { status: 204 })
}
