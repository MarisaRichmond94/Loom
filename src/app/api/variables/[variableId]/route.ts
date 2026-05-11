import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ variableId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { variableId } = await params
  const { name, type, defaultValue } = await req.json()
  try {
    const variable = await prisma.storyVariable.update({
      where: { id: variableId },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(defaultValue !== undefined && { defaultValue: JSON.stringify(defaultValue) }),
      },
    })
    return NextResponse.json(variable)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { variableId } = await params
  try {
    await prisma.storyVariable.delete({ where: { id: variableId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
