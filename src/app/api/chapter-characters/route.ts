import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canonNumbersForBook } from '@/lib/crossAppJump'
import { buildChapterLinks, parseCharacterIds, type LinkRow } from '@/lib/chapterCharacters'

// Which Loom chapters a set of WriteAI writer-characters appear in (LOOM-33).
//
// The outbound half of the seam: WriteAI's Characters pane calls this to turn
// the `wc-` ids it holds into displayable chapter links. Only Loom can answer,
// because it owns both the join and the canon numbering.
//
// ⚠️ READ-ONLY, and it must stay that way. Chapter numbers come from the canon
// WALK (canonNumbersForBook), never the canon EXPORT: the export returns the
// same numbers but writes .pages/.txt/.docx to ~/Writing on its way there, and
// this route runs on every Characters-pane render. Wiring it to the export
// path would rewrite the manuscript on every page load and kick off a WriteAI
// ingest each time. tests/unit/chapterCharactersRoute.test.ts pins this at the
// source level, the same way the events route is pinned.

export async function GET(req: Request) {
  const ids = parseCharacterIds(new URL(req.url).searchParams.get('characterIds'))
  if (ids.length === 0) return NextResponse.json({})

  const rows = await prisma.chapterCharacter.findMany({
    where: { writerCharacterId: { in: ids } },
    select: {
      writerCharacterId: true,
      chapterId: true,
      chapter: {
        select: {
          title: true,
          bookId: true,
          book: { select: { title: true, order: true, seriesId: true, series: { select: { title: true } } } },
        },
      },
    },
  })

  // One walk per distinct book, not per chapter. A main character across forty
  // chapters of one book is one manuscript load, not forty.
  const books = new Map<string, string>() // bookId -> seriesId
  for (const row of rows) books.set(row.chapter.bookId, row.chapter.book.seriesId)
  const numbers = new Map<string, number | null>()
  for (const [bookId, seriesId] of books) {
    for (const [id, n] of await canonNumbersForBook(seriesId, bookId)) numbers.set(id, n)
  }

  return NextResponse.json(buildChapterLinks(ids, rows as LinkRow[], numbers))
}
