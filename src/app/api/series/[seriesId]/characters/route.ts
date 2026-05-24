import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const characters = await prisma.character.findMany({ where: { seriesId }, orderBy: { name: 'asc' } })
  return NextResponse.json(characters.map(c => ({
    ...c,
    hasAvatar: existsSync(path.join(process.cwd(), 'public', 'characters', `${c.id}.jpg`)),
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
