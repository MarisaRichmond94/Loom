// Shared machinery for the chapter↔WriteAI tag joins (LOOM-32 / LOOM-33).
//
// Events and characters are tagged to chapters the same way: Loom stores a
// prefixed WriteAI id, keyed by chapter cuid, and answers "which other
// chapters is this in?". The entity-shaped parts live in chapterEvents.ts and
// chapterCharacters.ts; the parts that are genuinely identical live here, so
// the two cannot drift into validating or ordering differently. crossAppJump
// makes the same argument for the two jump-link variants.

/** One chapter something is tagged in, as both tabs render it. */
export type ChapterAppearance = {
  chapterId: string
  chapterTitle: string
  /** Canon display number (0 = prologue), or null when the chapter has no
   *  canon address — displayable, just not linkable. */
  chapterNumber: number | null
  bookId: string
  bookTitle: string
  /** Book.order — the series' reading order. Carried so appearances sort
   *  chronologically; the title sorts alphabetically, which is only
   *  coincidentally right. */
  bookOrder: number
}

/**
 * Validate a WriteAI id from a request body.
 *
 * Checks the prefix but NOT the suffix. The prefix is the meaningful
 * invariant — it catches a name or a chapter cuid posted into the wrong
 * field, which is the realistic bug. Pinning the suffix would turn an
 * id-format change in the other app into silently unsavable tags, and this
 * side has no reason to care what the digits look like.
 */
export function parseTaggedId(
  payload: unknown,
  prefix: string,
  field: string,
): { id: string } | { error: string } {
  const raw = (payload as Record<string, unknown> | null)?.[field]
  if (typeof raw !== 'string') return { error: `${field} must be a string` }
  const id = raw.trim()
  if (!id) return { error: `${field} must not be empty` }
  // Length cap so a malformed client cannot write unbounded rows. Generous
  // enough that a format change upstream will not hit it.
  if (id.length > 64) return { error: `${field} is too long` }
  if (!id.startsWith(prefix)) return { error: `${field} must start with "${prefix}"` }
  return { id }
}

/**
 * Split a comma-separated id list from a query string.
 *
 * Tolerant on the way in — blanks and duplicates are normal when the caller
 * builds the list from a rendered page — but capped, and invalid ids are
 * DROPPED rather than 400ing: one stale id must not blank every other entry's
 * links.
 */
export function parseIdList(param: string | null, prefix: string, max = 500): string[] {
  if (!param) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of param.split(',')) {
    const parsed = parseTaggedId({ id: part }, prefix, 'id')
    if ('error' in parsed || seen.has(parsed.id)) continue
    seen.add(parsed.id)
    out.push(parsed.id)
    if (out.length >= max) break
  }
  return out
}

/**
 * Stable, readable order for a list of appearances: by book in READING order,
 * then by chapter number, with unnumbered chapters LAST rather than sorting as
 * 0 and jumping ahead of the prologue.
 *
 * Books sort on Book.order, not on title. Sorting by title is alphabetical
 * order wearing chronological order's clothes — it happens to agree for some
 * series and silently disagrees for others, and a spread that lists book three
 * before book one reads as a bug in the tags rather than in the sort. Title
 * remains only as a tiebreak for two books that share an order.
 */
export function compareAppearances(a: ChapterAppearance, b: ChapterAppearance): number {
  return (
    a.bookOrder - b.bookOrder ||
    a.bookTitle.localeCompare(b.bookTitle) ||
    (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity) ||
    a.chapterTitle.localeCompare(b.chapterTitle)
  )
}
