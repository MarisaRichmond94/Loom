import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ sceneId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { sceneId } = await params
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: {
      blocks: {
        orderBy: { order: 'asc' },
        include: {
          choices: true,
          overrides: { orderBy: { order: 'asc' } },
        },
      },
    },
  })
  if (!scene) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(scene)
}

export async function PATCH(req: Request, { params }: Params) {
  const { sceneId } = await params
  const data = await req.json()
  const scene = await prisma.scene.update({ where: { id: sceneId }, data })
  return NextResponse.json(scene)
}

export async function DELETE(_: Request, { params }: Params) {
  const { sceneId } = await params
  await prisma.scene.delete({ where: { id: sceneId } })
  return new NextResponse(null, { status: 204 })
}
