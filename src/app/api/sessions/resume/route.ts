import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readProfileSettings } from '@/lib/profileSettings'

// Batch-enrich a list of session IDs (sourced from the reader's localStorage)
// with everything the Continue Reading card needs: current book cover/title,
// current chapter title + position, total chapters in the book (for the
// progress bar), the resolved byline (per-series override or global
// profile), and the session's updatedAt for "most recent first" ordering.
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
      series: { select: { id: true, title: true, authorOverrideName: true } },
    },
  })

  // Resolve currentBlockId → chapter → book in one extra query, including
  // the book's chapter count (for the progress denominator) and cover.
  const blockIds = sessions
    .map(s => s.currentBlockId)
    .filter((id): id is string => !!id)
  const blocks = blockIds.length > 0
    ? await prisma.contentBlock.findMany({
        where: { id: { in: blockIds } },
        include: {
          chapter: {
            select: {
              id: true,
              title: true,
              order: true,
              book: {
                select: {
                  id: true,
                  title: true,
                  order: true,
                  coverPath: true,
                  _count: { select: { chapters: true } },
                },
              },
            },
          },
        },
      })
    : []
  const blockById = new Map(blocks.map(b => [b.id, b]))

  // Pull the global profile once so the per-session fallback path doesn't
  // re-read the file in a loop. Demo series ship their own override.
  const profile = await readProfileSettings()
  const globalDisplayName =
    profile.pseudonymEnabled && profile.pseudonym.trim()
      ? profile.pseudonym.trim()
      : profile.authorName.trim()

  return NextResponse.json(sessions.map(s => {
    const block = s.currentBlockId ? blockById.get(s.currentBlockId) ?? null : null
    let historyLength = 0
    try { historyLength = (JSON.parse(s.choiceHistory) as unknown[]).length } catch { /* default 0 */ }
    return {
      sessionId: s.id,
      seriesId: s.seriesId,
      seriesTitle: s.series.title,
      // Author byline — per-series override (demo) beats the global profile.
      authorName: s.series.authorOverrideName?.trim() || globalDisplayName,
      // Current book the reader is in. The cover here is the book the
      // user is actively reading, not the series' first book.
      currentBookId: block?.chapter.book.id ?? null,
      currentBookTitle: block?.chapter.book.title ?? null,
      currentBookCoverPath: block?.chapter.book.coverPath ?? null,
      currentBookChapterCount: block?.chapter.book._count.chapters ?? 0,
      currentChapterId: block?.chapter.id ?? null,
      currentChapterTitle: block?.chapter.title ?? null,
      currentChapterOrder: block?.chapter.order ?? null,
      // hasProgress filters out brand-new sessions that the reader bounced
      // from before answering anything — those shouldn't clutter Continue
      // Reading.
      hasProgress: !!s.currentBlockId || historyLength > 0,
      // Drives "most recently opened first" sort on the client.
      updatedAt: s.updatedAt.toISOString(),
    }
  }))
}
