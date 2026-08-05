import { canonNumbersForBook } from '@/lib/crossAppJump'
import { normBookTitle } from '@/lib/exploreScope'
import { prisma } from '@/lib/prisma'

// Citation → the chapter's Loom cuid, for the editor link (LOOM-115).
//
// A citation carries WriteAI's address (book title + chapter number). Loom
// addresses chapters by cuid, and the bridge is the canon WALK.
//
// ⚠️ THE WALK, NEVER THE EXPORT. `canonNumbersForBook` is read-only.
// `POST .../export/canon` returns the same numbers but writes
// `.pages`/`.txt`/`.docx` to the writer's folder on the way — wiring that here
// would rewrite the manuscript on every citation click and trigger a WriteAI
// ingest each time. `tests/unit/exploreCitationLink.test.ts` pins this, the
// same way `chapterEventsRoute.test.ts` pins it for the timeline.
//
// Resolved in a batch: an answer cites several chapters, usually across two or
// three books, and a request per citation would walk the same book repeatedly.

export const dynamic = 'force-dynamic'

type Ask = { book?: unknown; chapter?: unknown }

export async function POST(req: Request) {
  let body: { seriesId?: string; citations?: Ask[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { seriesId } = body
  if (!seriesId) return Response.json({ error: 'seriesId is required' }, { status: 400 })
  const asks = Array.isArray(body.citations) ? body.citations : []
  if (asks.length === 0) return Response.json({ links: {} })

  const books = await prisma.book.findMany({
    where: { seriesId },
    select: { id: true, title: true },
  })
  const byTitle = new Map(books.map(b => [normBookTitle(b.title), b.id]))

  // One walk per distinct book, not per citation.
  const wanted = new Map<string, Set<number>>()
  for (const ask of asks) {
    if (typeof ask?.book !== 'string' || !Number.isInteger(ask?.chapter)) continue
    const key = normBookTitle(ask.book)
    if (!byTitle.has(key)) continue
    const set = wanted.get(key) ?? new Set<number>()
    set.add(ask.chapter as number)
    wanted.set(key, set)
  }

  const links: Record<string, string> = {}
  for (const [titleKey, chapters] of wanted) {
    const bookId = byTitle.get(titleKey)
    if (!bookId) continue
    let numbers: Map<string, number | null>
    try {
      numbers = await canonNumbersForBook(seriesId, bookId)
    } catch {
      // A book that will not walk is a real state (a broken variable, say).
      // Its citations stay unlinked rather than failing every other link.
      continue
    }
    const byNumber = new Map<number, string>()
    for (const [chapterId, n] of numbers) {
      if (n !== null && !byNumber.has(n)) byNumber.set(n, chapterId)
    }
    for (const n of chapters) {
      const chapterId = byNumber.get(n)
      // An unresolvable citation gets NO key rather than a null one. The card
      // then renders unlinked with a reason, which keeps "the index and the
      // manuscript disagree" visible instead of hiding it.
      if (chapterId) links[`${titleKey}::${n}`] = `/author/${seriesId}/chapter/${chapterId}`
    }
  }

  return Response.json({ links })
}
