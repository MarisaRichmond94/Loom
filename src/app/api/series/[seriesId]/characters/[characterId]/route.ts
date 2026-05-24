import { NextResponse } from 'next/server'
import { unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ characterId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { characterId } = await params
  const { name, age, firstBookId, deathBookId, lastBookId, starred } = await req.json()
  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name.trim()
  if (age !== undefined) data.age = age === '' || age === null ? null : Number(age)
  if (firstBookId !== undefined) data.firstBookId = firstBookId ?? null
  if (deathBookId !== undefined) data.deathBookId = deathBookId ?? null
  if (lastBookId !== undefined) data.lastBookId = lastBookId ?? null
  if (starred !== undefined) data.starred = !!starred
  const character = await prisma.character.update({ where: { id: characterId }, data })
  const hasAvatar = existsSync(path.join(process.cwd(), 'public', 'characters', `${characterId}.jpg`))
  return NextResponse.json({ ...character, hasAvatar })
}

export async function DELETE(_: Request, { params }: Params) {
  const { characterId } = await params
  const charsDir = path.join(process.cwd(), 'public', 'characters')
  // Canonical avatar
  const canonical = path.join(charsDir, `${characterId}.jpg`)
  if (existsSync(canonical)) await unlink(canonical).catch(() => {})
  // Any per-book override avatars stored as <id>-<bookId>.jpg
  try {
    const entries = await readdir(charsDir)
    await Promise.all(entries
      .filter(name => name.startsWith(`${characterId}-`) && name.endsWith('.jpg'))
      .map(name => unlink(path.join(charsDir, name)).catch(() => null)))
  } catch { /* directory may not exist yet */ }
  // CharacterBookOverride rows cascade via Prisma's onDelete: Cascade.
  await prisma.character.delete({ where: { id: characterId } })
  return new NextResponse(null, { status: 204 })
}
