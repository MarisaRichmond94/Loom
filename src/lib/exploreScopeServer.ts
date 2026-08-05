// Data access for the Explore tab's scope (LOOM-112).
//
// The thin half: read Loom's books, read WriteAI's index, hand both to the
// pure `buildScope`. All the enforcement logic — the prefix rule's clamp, POV
// derivation — lives in exploreScope.ts so it can be unit tested; Loom's
// generated Prisma client is ESM and will not load under Jest, so anything
// importing it cannot be.

import { prisma } from './prisma'
import { callWriteAi } from './writeaiProxy'
import { buildScope, isUnindexed, type ExploreScope, type WriteAiBookRow } from './exploreScope'

/**
 * Resolve what this page may search.
 *
 * Four outcomes, deliberately distinct — the UI says something different for
 * each, and flattening them would make "WriteAI is off" indistinguishable from
 * "nothing here yet", which are opposite instructions to the writer:
 *
 *   `{ books, povs, lastSynced }`  resolved.
 *   `{ missing: 'book' }`          no such book, or it belongs to another series.
 *   `{ missing: 'series' }`        WriteAI has ingested NONE of this series' books.
 *   `{ response }`                 WriteAI is down or errored; return as-is.
 */
export async function resolveExploreScope(
  seriesId: string,
  bookId?: string | null,
): Promise<ExploreScope | { missing: 'book' | 'series' } | { response: Response }> {
  const all = await prisma.book.findMany({
    where: { seriesId },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, order: true },
  })

  // The series check is not ceremony: without it, any book id in the database
  // resolves through any series in the URL.
  let allowed = all
  if (bookId) {
    const current = all.find(b => b.id === bookId)
    if (!current) return { missing: 'book' }
    allowed = all.filter(b => b.order <= current.order)
  }
  if (allowed.length === 0) return { missing: 'series' }

  const result = await callWriteAi('/api/books', { cache: 'no-store' })
  if ('response' in result) return result

  const payload = result.data as { books?: WriteAiBookRow[]; last_synced?: string }
  const scope = buildScope(
    allowed,
    payload?.books ?? [],
    typeof payload?.last_synced === 'string' ? payload.last_synced : null,
  )

  // Nothing in this series is in WriteAI's index. Today that means "not
  // ingested yet"; the day a second series exists it also means "WriteAI is
  // configured for the other one" (LOOM-10). Both are the same instruction to
  // the writer — there is nothing here to ask about — and both are far better
  // than answering confidently out of another series' prose.
  if (isUnindexed(scope)) return { missing: 'series' }

  return scope
}
