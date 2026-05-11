import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deserializeSession } from '@/lib/sessionService'

type Params = { params: Promise<{ sessionId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { sessionId } = await params
  const session = await prisma.readerSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)
  return NextResponse.json({ ...session, storyState, choiceHistory })
}
