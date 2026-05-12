import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { applyChoice } from '@/lib/storyEngine'
import { deserializeSession, serializeSession } from '@/lib/sessionService'

type Params = { params: Promise<{ sessionId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { sessionId } = await params
  const { choicePointId, choiceId } = await req.json()

  if (!choicePointId || !choiceId) {
    return NextResponse.json({ error: 'choicePointId and choiceId required' }, { status: 400 })
  }

  const [session, choice] = await Promise.all([
    prisma.readerSession.findUnique({ where: { id: sessionId } }),
    prisma.choice.findUnique({ where: { id: choiceId } }),
  ])

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!choice) return NextResponse.json({ error: 'Choice not found' }, { status: 404 })

  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)
  const choiceRecord = {
    id: choice.id,
    setsVariables: JSON.parse(choice.setsVariables),
    targetChapterId: choice.targetChapterId,
  }
  const { newState, newHistory } = applyChoice(storyState, choiceHistory, choicePointId, choiceRecord)

  let currentBlockId = session.currentBlockId
  if (choice.targetChapterId) {
    const firstBlock = await prisma.contentBlock.findFirst({
      where: { chapterId: choice.targetChapterId },
      orderBy: { order: 'asc' },
    })
    currentBlockId = firstBlock?.id ?? null
  }

  const serialized = serializeSession(newState, newHistory)
  const updated = await prisma.readerSession.update({
    where: { id: sessionId },
    data: { ...serialized, currentBlockId },
  })

  const { storyState: state, choiceHistory: history } = deserializeSession(
    updated.storyState, updated.choiceHistory
  )
  return NextResponse.json({ ...updated, storyState: state, choiceHistory: history })
}
