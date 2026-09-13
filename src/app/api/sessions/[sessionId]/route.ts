import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deserializeSession, serializeSession } from '@/lib/sessionService'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import { shouldFork, isRewind, forkPointOf } from '@/lib/sessionFork'

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

  // ── Branch forking (LOOM-154, under LOOM-146) ─────────────────────────────
  //
  // ⚠️ THIS is the rewind path, not /api/sessions/[id]/rewind — that endpoint
  // has no callers. The reader recomputes state client-side and PATCHes it, so
  // a fork rule living only there would never fire.
  //
  // A rewind that changes which BOOKS the reader qualifies for creates a new
  // session from the restored state and leaves the original untouched, so a
  // branch you leave is still there when you come back. A rewind within a
  // branch updates in place, exactly as before.
  //
  // Nothing here deletes a session.
  const existing = await prisma.readerSession.findUnique({ where: { id: sessionId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const previous = deserializeSession(existing.storyState, existing.choiceHistory)
  if (isRewind(previous.choiceHistory, body.choiceHistory)) {
    const books = await prisma.book.findMany({
      where: { seriesId: existing.seriesId },
      select: { id: true, title: true, order: true, condition: true, canon: true },
      orderBy: { order: 'asc' },
    })
    if (shouldFork(books.map(b => ({ ...b, chapters: [] })), previous.storyState, body.storyState)) {
      const fork = await prisma.readerSession.create({
        data: {
          seriesId: existing.seriesId,
          storyState: serialized.storyState,
          choiceHistory: serialized.choiceHistory,
          currentBlockId: existing.currentBlockId,
          parentSessionId: existing.id,
          forkedAtChoicePointId: forkPointOf(previous.choiceHistory, body.choiceHistory),
        },
      })
      const forked = deserializeSession(fork.storyState, fork.choiceHistory)
      // `forked: true` tells the client to ADD this id to its list and continue
      // in it. Without that the original would drop out of Continue Reading,
      // which is the opposite of preserving it.
      return NextResponse.json({ ...fork, ...forked, forked: true })
    }
  }

  const session = await prisma.readerSession.update({
    where: { id: sessionId },
    data: { storyState: serialized.storyState, choiceHistory: serialized.choiceHistory },
  })
  const { storyState, choiceHistory } = deserializeSession(session.storyState, session.choiceHistory)
  return NextResponse.json({ ...session, storyState, choiceHistory, forked: false })
}
