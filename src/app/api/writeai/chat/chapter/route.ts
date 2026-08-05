import { callWriteAi } from '@/lib/writeaiProxy'

// One chapter's text, for the citation viewer (LOOM-115).
//
// Proxies `GET /api/books/{n}/chapters/{c}/text`.
//
// ⚠️ VERIFIED PURE BEFORE WIRING. The `/api/plan/*` GETs write to disk, so the
// family is not uniformly safe and "it's a GET" is not an argument. This one
// reads `chunks` out of sqlite and concatenates — no seeding, no reconcile, no
// save. It runs on every citation click, so that had to be checked rather than
// assumed.
//
// The book NUMBER is passed straight through rather than re-resolved from a
// title: the citation came from WriteAI and already carries its own address.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const book = Number(url.searchParams.get('book'))
  const chapter = Number(url.searchParams.get('chapter'))

  if (!Number.isInteger(book) || !Number.isInteger(chapter) || book < 0 || chapter < 0) {
    return Response.json(
      { error: 'book and chapter must be non-negative integers' },
      { status: 400 },
    )
  }

  const result = await callWriteAi(`/api/books/${book}/chapters/${chapter}/text`)
  if ('response' in result) return result.response
  return Response.json(result.data)
}
