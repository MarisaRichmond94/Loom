import { resolveExploreScope } from '@/lib/exploreScopeServer'

// What the Explore filter bar may offer (LOOM-112).
//
// Sourced from WriteAI's `GET /api/books`, which is a pure sqlite read — safe
// to call when the tab opens. The reduction happens here rather than in the
// browser: those rows carry a `stats` block and per-chapter word counts that a
// filter bar has no use for, and a second consumer must not be able to grow on
// fields this route never promised.
//
// ⚠️ The obvious wrong source for a character list is `GET /api/plan/characters`,
// which writes to disk on a GET. See the note in exploreScope.ts.
//
// This is deliberately NOT the existing `/api/writeai/books` route. That one
// reduces to bare names for the character modal's book chips, and widening it
// would change a payload something else already depends on.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  const bookId = url.searchParams.get('bookId')

  if (!seriesId) {
    return Response.json({ error: 'seriesId is required' }, { status: 400 })
  }

  const scope = await resolveExploreScope(seriesId, bookId)
  if ('response' in scope) return scope.response

  if ('missing' in scope) {
    // Both are real states rather than errors, and the tab renders a different
    // sentence for each — so they are 200s carrying a reason, the same shape
    // the insights tab established in LOOM-91.
    return Response.json({ status: scope.missing === 'book' ? 'unknown-book' : 'not-analyzed' },
      { status: scope.missing === 'book' ? 404 : 200 })
  }

  return Response.json({ status: 'ok', ...scope })
}
