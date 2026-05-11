import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params
  const { title } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const count = await prisma.scene.count({ where: { chapterId } })
  const scene = await prisma.scene.create({
    data: { chapterId, title: title.trim(), order: count + 1 },
  })
  return NextResponse.json(scene, { status: 201 })
}
