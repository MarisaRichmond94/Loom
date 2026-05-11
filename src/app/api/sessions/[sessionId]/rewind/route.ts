import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rewindTo } from '@/lib/storyEngine'
import { deserializeSession, serializeSession } from '@/lib/sessionService'

type Params = { params: Promise<{ sessionId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { sessionId } = await params
  const { choicePointId } = await req.json()

  const session = await prisma.readerSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)

  let restoredState, truncatedHistory
  try {
    ;({ restoredState, truncatedHistory } = rewindTo(choiceHistory, choicePointId))
  } catch {
    return NextResponse.json({ error: 'Choice point not in history' }, { status: 400 })
  }

  const serialized = serializeSession(restoredState, truncatedHistory)
  const updated = await prisma.readerSession.update({
    where: { id: sessionId },
    data: { ...serialized, currentBlockId: choicePointId },
  })

  const { storyState: state, choiceHistory: history } = deserializeSession(
    updated.storyState, updated.choiceHistory
  )
  return NextResponse.json({ ...updated, storyState: state, choiceHistory: history })
}
