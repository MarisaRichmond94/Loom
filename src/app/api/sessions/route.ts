import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildInitialState, serializeSession } from '@/lib/sessionService'

export async function POST(req: Request) {
  const { seriesId, startBlockId } = await req.json()
  if (!seriesId) return NextResponse.json({ error: 'seriesId required' }, { status: 400 })

  const variables = await prisma.storyVariable.findMany({ where: { seriesId } })
  const initialState = buildInitialState(variables)
  const { storyState, choiceHistory } = serializeSession(initialState, [])

  const session = await prisma.readerSession.create({
    data: { seriesId, currentBlockId: startBlockId ?? null, storyState, choiceHistory },
  })
  return NextResponse.json(session, { status: 201 })
}
