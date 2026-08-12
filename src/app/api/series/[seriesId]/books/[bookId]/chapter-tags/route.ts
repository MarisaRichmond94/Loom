import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { groupBookChapterTags, type TagRow } from '@/lib/bookChapterTags'

// The book's chapter sequence with its character and event tags (LOOM-120/121).
//
// Serves the Chapters tab. Sibling of .../events (LOOM-101), which answers the
// same data the other way round — per EVENT, its chapters. This one is per
// CHAPTER, in book order, because the tickets ask a spatial question ("show me
// every chapter Chase is in, and the spacing between them") that a per-entity
// spread cannot answer.
//
// Non-canon tags are INCLUDED and flagged, never filtered. Same reasoning the
// events route records: /api/chapter-events and /api/chapter-characters strip
// them because those are the routes WriteAI reads and WriteAI holds canon only.
// This is Loom talking to Loom, and the branch story is exactly what this view
// exists to show.
//
// Chapters are read from LOOM, not from WriteAI's outline. The outline is canon
// only — branch-gated chapters never get a card — so sourcing the sequence
// there would drop the Bonus Chapters this view was built for. Summaries are
// joined onto this list on the client, read-only.
//
// ⚠️ READ-ONLY, and it must stay that way. Chapter numbers come from the canon
// WALK (canonNumbersForBook), never the canon EXPORT: the export returns the
// same numbers but writes .pages/.txt/.docx to ~/Writing on its way there and
// kicks off a WriteAI ingest. This route runs on every render of the Chapters
// tab. tests/unit/bookChapterTagsRoute.test.ts pins this at the source level,
// exactly as its siblings do.

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  // Confirms the book exists AND belongs to the series in the path — an id
  // pair that does not match is a caller bug, and answering it with the book's
  // real chapters would make the mismatch invisible.
  const book = await prisma.book.findFirst({
    where: { id: bookId, seriesId },
    select: { id: true },
  })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  const [chapters, characterRows, eventRows] = await Promise.all([
    prisma.chapter.findMany({
      where: { bookId },
      // `summary` is joined explicitly, not spread. It lives in its own table
      // precisely so its body does NOT ride along in the bulk chapter queries
      // the outline tree and book page run; this view is the one that needs it.
      select: {
        id: true,
        title: true,
        order: true,
        pov: true,
        date: true,
        summary: { select: { body: true } },
      },
      orderBy: { order: 'asc' },
    }),
    prisma.chapterCharacter.findMany({
      where: { chapter: { bookId } },
      select: { chapterId: true, writerCharacterId: true, nonCanon: true },
    }),
    prisma.chapterEvent.findMany({
      where: { chapter: { bookId } },
      select: { chapterId: true, writerEventId: true, nonCanon: true },
    }),
  ])

  if (chapters.length === 0) return NextResponse.json({ chapters: [] })

  // One walk for the whole book. loadManuscriptBook is the expensive part of
  // this route, and it is per-book regardless of how many tags exist.
  const numbers = await canonNumbersForBook(seriesId, bookId)

  const toTagRow = (rows: { chapterId: string; nonCanon: boolean }[], idKey: string): TagRow[] =>
    rows.map(r => ({
      chapterId: r.chapterId,
      entityId: (r as unknown as Record<string, string>)[idKey],
      nonCanon: r.nonCanon ?? false,
    }))

  return NextResponse.json({
    chapters: groupBookChapterTags(
      chapters.map(c => ({
        id: c.id,
        title: c.title,
        order: c.order,
        pov: c.pov,
        date: c.date,
        manualSummary: c.summary?.body ?? null,
      })),
      toTagRow(characterRows, 'writerCharacterId'),
      toTagRow(eventRows, 'writerEventId'),
      numbers,
    ),
  })
}
