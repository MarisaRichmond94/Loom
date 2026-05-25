import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Batch-enrich a list of session IDs (sourced from the reader's localStorage)
// with the metadata the Continue Reading section needs: series title +
// hero cover, current book + chapter title, and a "hasProgress" flag.
// Sessions that don't exist anymore are filtered out so the client can
// prune them from localStorage.
export async function POST(req: Request) {
  let body: { sessionIds?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const sessionIds = Array.isArray(body.sessionIds)
    ? body.sessionIds.filter((x): x is string => typeof x === 'string')
    : []
  if (sessionIds.length === 0) return NextResponse.json([])

  const sessions = await prisma.readerSession.findMany({
    where: { id: { in: sessionIds } },
    include: {
      series: {
        include: {
          books: {
            where: { published: true },
            orderBy: { order: 'asc' },
            select: { id: true, coverPath: true, title: true, order: true },
          },
        },
      },
    },
  })

  // Resolve currentBlockId → chapter → book in one extra query.
  const blockIds = sessions
    .map(s => s.currentBlockId)
    .filter((id): id is string => !!id)
  const blocks = blockIds.length > 0
    ? await prisma.contentBlock.findMany({
        where: { id: { in: blockIds } },
        include: { chapter: { include: { book: { select: { id: true, title: true, order: true } } } } },
      })
    : []
  const blockById = new Map(blocks.map(b => [b.id, b]))

  return NextResponse.json(sessions.map(s => {
    const block = s.currentBlockId ? blockById.get(s.currentBlockId) ?? null : null
    let historyLength = 0
    try { historyLength = (JSON.parse(s.choiceHistory) as unknown[]).length } catch { /* default 0 */ }
    return {
      sessionId: s.id,
      seriesId: s.seriesId,
      seriesTitle: s.series.title,
      // Hero cover comes from the first published book — same rule the
      // Explore catalog uses, so the resume card matches the catalog card.
      seriesHeroCoverPath: s.series.books.find(b => b.coverPath)?.coverPath ?? null,
      currentChapterId: block?.chapter.id ?? null,
      currentChapterTitle: block?.chapter.title ?? null,
      currentBookTitle: block?.chapter.book.title ?? null,
      // hasProgress filters out brand-new sessions that the reader bounced
      // from before answering anything — those shouldn't clutter Continue
      // Reading.
      hasProgress: !!s.currentBlockId || historyLength > 0,
    }
  }))
}
