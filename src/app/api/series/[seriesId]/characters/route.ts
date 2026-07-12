import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { publicDirFilenames } from '@/lib/publicAssets'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const [characters, avatarFiles] = await Promise.all([
    prisma.character.findMany({ where: { seriesId }, orderBy: { name: 'asc' } }),
    publicDirFilenames('characters'),
  ])
  return NextResponse.json(characters.map(c => ({
    ...c,
    hasAvatar: avatarFiles.has(`${c.id}.jpg`),
  })))
}

export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  const { name, age, firstBookId, deathBookId, lastBookId, starred } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const character = await prisma.character.create({
    data: {
      seriesId,
      name: name.trim(),
      age: age ?? null,
      firstBookId: firstBookId ?? null,
      deathBookId: deathBookId ?? null,
      lastBookId: lastBookId ?? null,
      starred: starred ?? false,
    },
  })
  return NextResponse.json({ ...character, hasAvatar: false }, { status: 201 })
}
