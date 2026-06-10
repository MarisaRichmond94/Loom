import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const variables = await prisma.storyVariable.findMany({
    where: { seriesId },
    orderBy: { id: 'asc' },
  })
  return NextResponse.json(variables)
}

export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  const { name, type, defaultValue = null, originBookId = null } = await req.json()
  if (!name?.trim() || !['boolean', 'number', 'string'].includes(type)) {
    return NextResponse.json({ error: 'name and valid type required' }, { status: 400 })
  }
  const variable = await prisma.storyVariable.create({
    data: {
      seriesId,
      name: name.trim(),
      type,
      defaultValue: JSON.stringify(defaultValue),
      // Optional. The chapter editor passes its current book so the
      // Context modal can show where this variable came from; other
      // callers (e.g. sidebar Add Context outside a chapter page)
      // leave it null and the Origin column shows "—".
      ...(originBookId && { originBookId }),
    },
  })
  return NextResponse.json(variable, { status: 201 })
}
