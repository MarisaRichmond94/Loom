import { NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ characterId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { characterId } = await params
  const { name, age } = await req.json()
  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name.trim()
  if (age !== undefined) data.age = age === '' || age === null ? null : Number(age)
  const character = await prisma.character.update({ where: { id: characterId }, data })
  const hasAvatar = existsSync(path.join(process.cwd(), 'public', 'characters', `${characterId}.jpg`))
  return NextResponse.json({ ...character, hasAvatar })
}

export async function DELETE(_: Request, { params }: Params) {
  const { characterId } = await params
  const avatarPath = path.join(process.cwd(), 'public', 'characters', `${characterId}.jpg`)
  if (existsSync(avatarPath)) await unlink(avatarPath).catch(() => {})
  await prisma.character.delete({ where: { id: characterId } })
  return new NextResponse(null, { status: 204 })
}
