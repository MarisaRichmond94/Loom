// Reachability report for a series (LOOM-122).
//
// A PURE READ. It selects the structural columns the analysis needs — never
// prose — runs the analyzer in memory, and returns findings. No writes, no
// caching table, no side effects: opening the Paths tab cannot dirty anything,
// which is what keeps it clear of the "opened but not used must not write"
// trap that the Outline and Explore tabs had to be fixed for.
//
// Series-scoped by necessity, not preference: a variable set in book 2 is read
// in book 4, so a book-scoped analysis would either start from defaults and
// report most of the later books dead, or quietly walk the earlier books
// anyway and misreport its own scope.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { analyzeReachability } from '@/lib/reachability'

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params

  const books = await prisma.book.findMany({
    where: { seriesId },
    select: { id: true, title: true, order: true },
    orderBy: { order: 'asc' },
  })
  if (books.length === 0) {
    return NextResponse.json({
      findings: [],
      summary: {
        chapters: 0, choicePoints: 0, overrides: 0, gatedBlocks: 0, chapterGates: 0,
        gatedChoices: 0, variables: 0, peakStates: 0, dead: 0, warnings: 0, deadByBook: {},
      },
    })
  }
  const bookIds = books.map(b => b.id)

  const chapters = await prisma.chapter.findMany({
    where: { bookId: { in: bookIds } },
    select: { id: true, bookId: true, title: true, order: true, condition: true },
    orderBy: { order: 'asc' },
  })
  const chapterIds = chapters.map(c => c.id)

  // Structural columns only — `content` and `baseContent` are deliberately not
  // selected. The analysis never looks at prose, and shipping a whole series'
  // manuscript into memory to count branches would be absurd.
  const blocks = await prisma.contentBlock.findMany({
    where: { chapterId: { in: chapterIds } },
    select: { id: true, chapterId: true, order: true, type: true, condition: true },
    orderBy: { order: 'asc' },
  })
  const blockIds = blocks.map(b => b.id)

  const [choices, overrides, variables] = await Promise.all([
    prisma.choice.findMany({
      where: { choicePointId: { in: blockIds } },
      select: {
        id: true, choicePointId: true, order: true, label: true,
        setsVariables: true, condition: true, isBadEnding: true, endsChapter: true,
      },
      orderBy: { order: 'asc' },
    }),
    prisma.conditionalOverride.findMany({
      where: { conditionalFragmentId: { in: blockIds } },
      select: {
        id: true, conditionalFragmentId: true, order: true,
        condition: true, endsChapter: true,
      },
      orderBy: { order: 'asc' },
    }),
    prisma.storyVariable.findMany({
      where: { seriesId },
      select: { name: true, type: true, defaultValue: true },
    }),
  ])

  const report = analyzeReachability({ books, chapters, blocks, choices, overrides, variables })
  return NextResponse.json(report)
}
