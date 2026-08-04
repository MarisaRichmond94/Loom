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

import { callWriteAi } from './writeaiProxy'

const norm = (s: string) =>
  s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()

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
