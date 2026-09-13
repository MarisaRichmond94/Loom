// When does a rewind fork the session? (LOOM-154, under LOOM-146)
//
// Rewinding used to truncate choiceHistory IN PLACE, so the branch being left
// was simply overwritten — exploring the other option cost you the one you were
// on. Progress is now preserved in both branches by forking.
//
// ── FORK ONLY WHEN THE QUALIFYING BOOK SET CHANGES ───────────────────────────
//
// Forking on EVERY rewind would spawn a session for every "let me see the other
// option" poke, and a Continue Reading list of near-identical entries is worse
// than no forking at all. So:
//
//   qualifyingBooks(current) != qualifyingBooks(restored)  ->  fork
//   otherwise                                              ->  truncate in place
//
// Forks then exist exactly where the word "branch" means something. A rewind
// inside a branch still loses the chapters after it, which is what rewinding
// has always meant and what the reader is asking for.
//
// ── WHY A BOOK SET AND NOT A POSITION ────────────────────────────────────────
//
// Position alone is not enough to restore a branch: an alt-book position
// restored WITHOUT the storyState that qualified the reader for it evaluates
// that book's chapter conditions against canon state — wrong prose, or chapters
// vanishing mid-book. The book set is the thing that actually differs between
// branches, so it is what the decision is made on.
//
// Pure: the caller loads the books and passes both states in.

import { isBookVisible, type BookIn } from '@/lib/chapterLabels'
import type { StoryState } from '@/lib/storyEngine'

export function qualifyingBookIds(books: BookIn[], state: StoryState): string[] {
  return books.filter(b => isBookVisible(b, state)).map(b => b.id).sort()
}

/**
 * Does rewinding from `current` to `restored` cross a branch boundary?
 *
 * Note this is symmetric and set-based, not a count: swapping canon book 4 for
 * an alt book keeps the SIZE the same, so comparing lengths would miss the one
 * case the whole feature exists for.
 */
export function shouldFork(
  books: BookIn[],
  current: StoryState,
  restored: StoryState,
): boolean {
  const before = qualifyingBookIds(books, current)
  const after = qualifyingBookIds(books, restored)
  if (before.length !== after.length) return true
  return before.some((id, i) => id !== after[i])
}

/**
 * Was this session update a REWIND?
 *
 * `choiceHistory` only ever shrinks via a rewind — ReaderView documents this
 * invariant and relies on it to force-close its panels — so a shorter incoming
 * history is the signal, and it needs no new field on the request.
 *
 * Why this matters: the rewind ENDPOINT (/api/sessions/[id]/rewind) has no
 * callers. The reader rewinds by recomputing state client-side and PATCHing the
 * session, so a fork rule living only in that endpoint would never fire. Both
 * paths call this.
 */
export function isRewind(before: unknown[], after: unknown[]): boolean {
  return after.length < before.length
}

/**
 * The choice point the reader is going back to re-answer — the first one
 * dropped by the rewind. Names the branch in the UI.
 *
 * Not the last KEPT choice: that one is unchanged in both branches, so it says
 * nothing about what separates them.
 */
export function forkPointOf(
  before: { choicePointId: string }[],
  after: unknown[],
): string | null {
  return before[after.length]?.choicePointId ?? null
}
