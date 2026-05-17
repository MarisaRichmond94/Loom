import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deserializeSession, serializeSession } from '@/lib/sessionService'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'

type Params = { params: Promise<{ sessionId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { sessionId } = await params
  const session = await prisma.readerSession.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)
  return NextResponse.json({ ...session, storyState, choiceHistory })
}

export async function PATCH(req: Request, { params }: Params) {
  const { sessionId } = await params
  const body = await req.json() as { storyState?: StoryState; choiceHistory?: HistoryEntry[] }
  if (!body.storyState || !body.choiceHistory) {
    return NextResponse.json({ error: 'storyState and choiceHistory required' }, { status: 400 })
  }
  const serialized = serializeSession(body.storyState, body.choiceHistory)
  const session = await prisma.readerSession.update({
    where: { id: sessionId },
    data: { storyState: serialized.storyState, choiceHistory: serialized.choiceHistory },
  })
  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)
  return NextResponse.json({ ...session, storyState, choiceHistory })
}
