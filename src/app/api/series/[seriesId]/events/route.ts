import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { groupSeriesEvents, type SeriesTagRow } from '@/lib/chapterEvents'

// Which WriteAI writer-events are tagged anywhere in this series (LOOM-107).
//
// The series-scope sibling of the book route. The series timeline does not
// FILTER by this — it shows every event, tagged or not — it needs the tags to
// answer a different question: is this event referenced only on non-canon
// branches? That badge is the one thing Loom's timeline can show that
// WriteAI's structurally cannot, and it needs series-wide tags to be
// scope-correct (an event branch-only in book 2 and canon in book 4 is CANON
// here, and branch-only on book 2's own tab).
//
// Non-canon tags are INCLUDED and flagged, as on the book route, and for the
// same reason: /api/chapter-events strips them because WriteAI reads it and
// holds canon only. This is Loom talking to Loom.
//
// ⚠️ READ-ONLY. Chapter numbers come from the canon WALK, never the canon
// EXPORT — the export writes .pages/.txt/.docx to ~/Writing on its way to the
// same numbers, and this runs on every render of the series Timeline tab.
// tests/unit/seriesEventsRoute.test.ts guards it at source level.

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params

  const series = await prisma.series.findUnique({ where: { id: seriesId }, select: { id: true } })
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 })

  const rows = await prisma.chapterEvent.findMany({
    where: { chapter: { book: { seriesId } } },
    select: {
      writerEventId: true,
      chapterId: true,
      nonCanon: true,
      chapter: {
        select: { title: true, bookId: true, book: { select: { title: true, order: true } } },
      },
    },
  })

  if (rows.length === 0) return NextResponse.json({ events: [] })

  // One walk per book that ACTUALLY HAS TAGS, not per book in the series.
  // loadManuscriptBook is the expensive part of this route, and in practice
  // most books carry no tags at all — walking them would be pure waste.
  const numbers = new Map<string, number | null>()
  const bookIds = new Set(rows.map(r => r.chapter.bookId))
  for (const bookId of bookIds) {
    for (const [id, n] of await canonNumbersForBook(seriesId, bookId)) numbers.set(id, n)
  }

  return NextResponse.json({ events: groupSeriesEvents(rows as SeriesTagRow[], numbers) })
}
