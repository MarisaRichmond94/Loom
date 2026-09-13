import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rewindTo } from '@/lib/storyEngine'
import { deserializeSession, serializeSession } from '@/lib/sessionService'
import { shouldFork } from '@/lib/sessionFork'

// Rewind to an earlier choice point (LOOM-154 made this the fork point).
//
// ⚠️ THE ONE PLACE THE BRANCHING MODEL IS ENFORCED.
//
// Rewinding is the ONLY way back to an abandoned branch — going forward into a
// divergence for the first time costs nothing, because the books that disappear
// have not been read yet. So every path that could lose a branch passes through
// here, and there is no fourth case hiding elsewhere.
//
// A rewind that crosses a branch boundary creates a NEW session from the
// restored state and leaves the original untouched. A rewind within a branch
// truncates in place, exactly as it always has.
//
// Nothing here deletes a ReaderSession, and nothing should: the entire point is
// that a branch you leave is still there when you come back.

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

  // Book gates are series-scoped, so the whole series' books are the input.
  // `canon` is irrelevant to the decision — what matters is which books this
  // reader can SEE, and a gated canon book disappearing is as much a branch
  // change as an alt book appearing.
  const books = await prisma.book.findMany({
    where: { seriesId: session.seriesId },
    select: { id: true, title: true, order: true, condition: true, canon: true },
    orderBy: { order: 'asc' },
  })
  const forking = shouldFork(
    books.map(b => ({ ...b, chapters: [] })),
    storyState,
    restoredState,
  )

  const serialized = serializeSession(restoredState, truncatedHistory)

  if (forking) {
    // CREATE, then hand the client the new id. The original is not read from,
    // not written to, and not deleted — it is simply left where it was.
    const fork = await prisma.readerSession.create({
      data: {
        seriesId: session.seriesId,
        ...serialized,
        currentBlockId: choicePointId,
        // A fork of a fork points at the fork it came from, so the chain stays
        // walkable rather than collapsing everything onto the first session.
        parentSessionId: session.id,
        forkedAtChoicePointId: choicePointId,
      },
    })
    const { storyState: state, choiceHistory: history } = deserializeSession(
      fork.storyState, fork.choiceHistory,
    )
    // `forked` tells the client to ADD this id to its list rather than treat it
    // as the same session moved — without it the original would drop out of
    // Continue Reading, which is the opposite of the point.
    return NextResponse.json({ ...fork, storyState: state, choiceHistory: history, forked: true })
  }

  const updated = await prisma.readerSession.update({
    where: { id: sessionId },
    data: { ...serialized, currentBlockId: choicePointId }, // Store the choice point block ID so the reader page can locate the chapter via block lookup
  })

  const { storyState: state, choiceHistory: history } = deserializeSession(
    updated.storyState, updated.choiceHistory
  )
  return NextResponse.json({ ...updated, storyState: state, choiceHistory: history, forked: false })
}
