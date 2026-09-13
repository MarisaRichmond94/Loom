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

  // Per-session "where are they reading" anchor:
  //   1. Prefer currentBlockId if the session has one.
  //   2. Otherwise use the most recent answered choice's choicePointId —
  //      that block sits in the chapter the reader last interacted with.
  // Either way we end up at a real block → chapter → book triplet, which
  // is what the card renders against.
  const lastChoicePointBySession = new Map<string, string>()
  const anchorBlockIds = new Set<string>()
  for (const s of sessions) {
    if (s.currentBlockId) {
      anchorBlockIds.add(s.currentBlockId)
      continue
    }
    try {
      const history = JSON.parse(s.choiceHistory) as { choicePointId?: string }[]
      const last = history[history.length - 1]
      if (last?.choicePointId) {
        lastChoicePointBySession.set(s.id, last.choicePointId)
        anchorBlockIds.add(last.choicePointId)
      }
    } catch { /* malformed history — fall through; card just won't be rich */ }
  }

  const blocks = anchorBlockIds.size > 0
    ? await prisma.contentBlock.findMany({
        where: { id: { in: [...anchorBlockIds] } },
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

  // ── Branch grouping (LOOM-154, under LOOM-146) ────────────────────────────
  //
  // Forks are ordinary sessions, so without this the Continue Reading list
  // shows two cards with the same cover and title, distinguishable only by
  // chapter. Grouping them under the series needs two things: which group a
  // session belongs to, and what to call its branch.
  //
  // The label is the CHOICE THIS SESSION MADE at the fork point — resolved from
  // its own history rather than stored, because at the moment a fork is created
  // it has not answered that choice point yet. A branch has no name until the
  // reader has actually taken it, and "unnamed until chosen" is the honest
  // state rather than a placeholder.
  const groupOf = (row: { id: string; parentSessionId: string | null }) =>
    row.parentSessionId ?? row.id

  // Fork points, by group. A fork stores the point it split at; the parent does
  // not, so the parent inherits its children's.
  const forkPointByGroup = new Map<string, string>()
  for (const row of sessions) {
    if (row.parentSessionId && row.forkedAtChoicePointId) {
      forkPointByGroup.set(groupOf(row), row.forkedAtChoicePointId)
    }
  }

  // choiceId each session took at its group's fork point.
  const choiceIdBySession = new Map<string, string>()
  for (const row of sessions) {
    const point = forkPointByGroup.get(groupOf(row))
    if (!point) continue
    try {
      const history = JSON.parse(row.choiceHistory) as { choicePointId?: string; choiceId?: string }[]
      const entry = history.find(e => e.choicePointId === point)
      if (entry?.choiceId) choiceIdBySession.set(row.id, entry.choiceId)
    } catch { /* malformed history — the branch simply goes unlabelled */ }
  }

  const branchLabels = new Map<string, string>()
  if (choiceIdBySession.size > 0) {
    const rows = await prisma.choice.findMany({
      where: { id: { in: [...new Set(choiceIdBySession.values())] } },
      select: { id: true, label: true },
    })
    const labelById = new Map(rows.map(r => [r.id, r.label]))
    for (const [sessionId, choiceId] of choiceIdBySession) {
      const label = labelById.get(choiceId)
      if (label) branchLabels.set(sessionId, label)
    }
  }

  // Pull the global profile once so the per-session fallback path doesn't
  // re-read the file in a loop. Demo series ship their own override.
  const profile = await readProfileSettings()
  const globalDisplayName =
    profile.pseudonymEnabled && profile.pseudonym.trim()
      ? profile.pseudonym.trim()
      : profile.authorName.trim()

  return NextResponse.json(sessions.map(s => {
    let block = s.currentBlockId ? blockById.get(s.currentBlockId) ?? null : null
    if (!block) {
      const fallbackId = lastChoicePointBySession.get(s.id)
      if (fallbackId) block = blockById.get(fallbackId) ?? null
    }
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
      currentBookOrder: block?.chapter.book.order ?? null,
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
      // Branch grouping (LOOM-154). `branchGroupId` equals `sessionId` for an
      // unforked session, so the client can group unconditionally rather than
      // branching on whether forks exist.
      branchGroupId: s.parentSessionId ?? s.id,
      isFork: !!s.parentSessionId,
      // Null until the reader has actually answered the fork point on this
      // branch — see the note above.
      branchLabel: branchLabels.get(s.id) ?? null,
    }
  }))
}
