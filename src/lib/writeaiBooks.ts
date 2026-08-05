// Resolving a Loom book to the number WriteAI addresses it by (LOOM-91).
//
// WriteAI's per-book endpoints take a book NUMBER (`/api/books/{n}/…`), which
// is positional — it comes from `chunks.book_number`, assigned at ingest. Loom
// knows books by cuid and title. Nothing in either app maps one to the other
// except `GET /api/books`, whose rows carry both (`id` = the number, `name` =
// the title), so the join is on the title.
//
// Titles crossing a process boundary need normalising: the two datastores hold
// them independently, and a curly apostrophe on one side is a silent miss on
// the other. `Nobody's Hero` is the live example. Same normalisation the review
// proxy has used since KAN-22 — kept identical on purpose, because two book
// lookups that disagree about what counts as the same title is a bug that only
// shows up on one book.
//
// Shared rather than per-route: the insights tab (LOOM-91) and the plan outline
// (LOOM-95) both need it, and a second copy is how the two drift.

import { prisma } from './prisma'
import { callWriteAi } from './writeaiProxy'

/**
 * Book-title normalisation for the cross-app join.
 *
 * Exported so the Explore scope resolver (LOOM-112) uses the SAME rule rather
 * than a third copy — two book lookups that disagree about what counts as the
 * same title is a bug that shows up on exactly one book, which is how
 * `Nobody's Hero` found it the first time.
 */
export const normBookTitle = (s: string) =>
  s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()

const norm = normBookTitle

/**
 * WriteAI's number for the book Loom calls `title`.
 *
 * `{ number: null }` means WriteAI has no book by that name — it has not
 * ingested this one yet, or the titles have diverged. That is a real state and
 * not an error: the caller reports "nothing analysed here" rather than failing.
 *
 * `{ response }` is a Response to return as-is, on WriteAI's own failure modes.
 */
export async function writeaiBookNumber(
  title: string,
): Promise<{ number: number | null } | { response: Response }> {
  const result = await callWriteAi('/api/books', { cache: 'no-store' })
  if ('response' in result) return result

  const rows = ((result.data as { books?: unknown })?.books ?? []) as {
    id?: number
    name?: string
  }[]
  const match = rows.find(b => typeof b.name === 'string' && norm(b.name) === norm(title))
  return { number: typeof match?.id === 'number' ? match.id : null }
}

/**
 * The book's title, or null if Loom has no such book in that series.
 *
 * Split out from `resolveWriteaiBook` because callers that do other work
 * between the two halves need the cheap half on its own — the insights route
 * answers "is this chapter even addressable?" before it is willing to talk to
 * WriteAI, but must still 404 an unknown book id rather than reporting it as an
 * unaddressable chapter.
 *
 * The series check is not ceremony: without it, any book id in the database
 * resolves through any series in the URL.
 */
export async function loomBookTitle(seriesId: string, bookId: string): Promise<string | null> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { title: true, seriesId: true },
  })
  return book && book.seriesId === seriesId ? book.title : null
}

/**
 * A Loom book id → WriteAI's number for it, with the ownership check.
 *
 * The whole journey every per-book proxy makes: confirm the book exists and
 * belongs to the series in the URL, then translate its title. Shared because
 * both the insights tab (LOOM-91) and the plan outline (LOOM-95) make it, and
 * two copies of a cross-app lookup is two places for the normalisation to drift.
 *
 * Four outcomes, deliberately distinct — the callers render three different
 * sentences and pass the fourth through:
 *
 *   `{ number }`            resolved.
 *   `{ missing: 'book' }`   Loom has no such book, or it is in another series.
 *   `{ missing: 'writeai' }` WriteAI has never ingested it.
 *   `{ response }`          WriteAI is down or errored; return it as-is.
 */
export async function resolveWriteaiBook(
  seriesId: string,
  bookId: string,
): Promise<
  { number: number } | { missing: 'book' | 'writeai' } | { response: Response }
> {
  const title = await loomBookTitle(seriesId, bookId)
  if (title === null) return { missing: 'book' }

  const resolved = await writeaiBookNumber(title)
  if ('response' in resolved) return resolved
  return resolved.number === null ? { missing: 'writeai' } : { number: resolved.number }
}
