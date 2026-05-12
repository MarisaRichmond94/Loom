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
          choices: { orderBy: { id: 'asc' } },
          overrides: { orderBy: { order: 'asc' } },
        },
      },
    },
  })
  if (!scene) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(scene)
}
