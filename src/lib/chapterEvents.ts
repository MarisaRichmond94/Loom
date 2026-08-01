// Chapter ↔ WriteAI writer-event tags (LOOM-32).
//
// Loom stores only the event id; the event itself lives in WriteAI. The pure
// parts of that seam live here — request validation and the shaping of the
// "also in Ch. 7" spread — so they can be tested without a database or a
// running WriteAI. The route handlers stay thin around them.

/** A row of the spread: one other chapter the same event is tagged in. */
export type EventAppearance = {
  chapterId: string
  chapterTitle: string
  /** Canon display number (0 = prologue), or null when the chapter has no
   *  canon address. Null is displayable ("also in an unnumbered chapter"),
   *  it just isn't linkable. */
  chapterNumber: number | null
  bookId: string
  bookTitle: string
}

export type TaggedEvent = {
  writerEventId: string
  taggedAt: string
  /** Other chapters this event is tagged in — never includes the chapter
   *  being asked about. Empty when it is tagged here and nowhere else. */
  alsoIn: EventAppearance[]
}

/**
 * Validate a POST body down to the one field we store.
 *
 * Deliberately checks the `we-` prefix but NOT the suffix format. The prefix is
 * the meaningful invariant — it catches a title or a chapter id posted into the
 * wrong field, which is the realistic bug. Pinning the suffix (WriteAI mints
 * `we-` + 8 hex today) would turn a future id-format change in the other app
 * into silently unsavable tags, and this side has no reason to care.
 *
 * Returns the id, or the message to 400 with.
 */
export function parseWriterEventId(payload: unknown): { id: string } | { error: string } {
  const raw = (payload as { writerEventId?: unknown } | null)?.writerEventId
  if (typeof raw !== 'string') return { error: 'writerEventId must be a string' }
  const id = raw.trim()
  if (!id) return { error: 'writerEventId must not be empty' }
  // Length cap so a malformed client cannot write unbounded rows. Generous
  // enough that a format change upstream will not hit it.
  if (id.length > 64) return { error: 'writerEventId is too long' }
  if (!id.startsWith('we-')) return { error: 'writerEventId must start with "we-"' }
  return { id }
}

/**
 * Split the `eventIds` query param for the resolution endpoint.
 *
 * Tolerant on the way in — blanks and duplicates are normal when the caller is
 * building the list from a rendered page — but capped, because the param is
 * attacker-shaped in the sense that anything can put a megabyte in a query
 * string. Ids that fail validation are DROPPED rather than 400ing the whole
 * request: one stale id on a timeline should not blank every other event's
 * chapter links.
 */
export function parseEventIds(param: string | null, max = 500): string[] {
  if (!param) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of param.split(',')) {
    const parsed = parseWriterEventId({ writerEventId: part })
    if ('error' in parsed) continue
    if (seen.has(parsed.id)) continue
    seen.add(parsed.id)
    out.push(parsed.id)
    if (out.length >= max) break
  }
  return out
}

/** One chapter an event is tagged in, denormalised for WriteAI to render
 *  without resolving anything itself. */
export type ChapterLink = {
  seriesId: string
  seriesTitle: string
  bookId: string
  bookTitle: string
  chapterId: string
  chapterTitle: string
  /** Canon display number (0 = prologue), or null when the chapter has no
   *  canon address. */
  chapterNumber: number | null
  /** Reader deep link, RELATIVE — WriteAI already configures the Loom base URL
   *  (VITE_LOOM_URL) for its existing jump links, and Loom has no reliable way
   *  to know its own external origin. Null when there is no canon number to
   *  address: the tag is real and still worth showing, it just isn't clickable. */
  readPath: string | null
}

/** Row shape the resolution endpoint reads, joined up to the series. */
export type LinkRow = {
  writerEventId: string
  chapterId: string
  chapter: {
    title: string
    bookId: string
    book: { title: string; seriesId: string; series: { title: string } }
  }
}

/**
 * Group tag rows into per-event chapter links.
 *
 * Every requested id gets a key, including ids with no tags — an empty array
 * is a meaningful answer ("tagged nowhere"), and omitting the key would make
 * the caller guess whether it meant that or a lookup failure.
 */
export function buildChapterLinks(
  ids: string[],
  rows: LinkRow[],
  numbers: Map<string, number | null>,
): Record<string, ChapterLink[]> {
  const out: Record<string, ChapterLink[]> = {}
  for (const id of ids) out[id] = []
  for (const row of rows) {
    const list = out[row.writerEventId]
    if (!list) continue // a row for an id we were not asked about
    const chapterNumber = numbers.get(row.chapterId) ?? null
    list.push({
      seriesId: row.chapter.book.seriesId,
      seriesTitle: row.chapter.book.series.title,
      bookId: row.chapter.bookId,
      bookTitle: row.chapter.book.title,
      chapterId: row.chapterId,
      chapterTitle: row.chapter.title,
      chapterNumber,
      readPath:
        chapterNumber === null
          ? null
          : `/read/by-id/${row.chapter.book.seriesId}/${row.chapter.bookId}/${chapterNumber}`,
    })
  }
  for (const list of Object.values(out)) {
    list.sort(
      (a, b) =>
        a.bookTitle.localeCompare(b.bookTitle) ||
        (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity) ||
        a.chapterTitle.localeCompare(b.chapterTitle),
    )
  }
  return out
}

/** One ChapterEvent row joined to its chapter and book, as the route reads it. */
export type SpreadRow = {
  writerEventId: string
  chapterId: string
  chapter: {
    title: string
    bookId: string
    book: { title: string }
  }
}

/**
 * Group every tag for a set of events into per-event appearance lists, with
 * `forChapterId` itself left out.
 *
 * Split from the query because the interesting cases — an event tagged only
 * here, tagged across two books, tagged in a chapter with no canon number —
 * are all shape, not SQL.
 *
 * `numbers` maps chapter id to canon display number; a chapter missing from it
 * is reported as `chapterNumber: null` rather than dropped, so a tag on an
 * unnumbered chapter stays visible.
 */
export function groupAppearances(
  rows: SpreadRow[],
  forChapterId: string,
  numbers: Map<string, number | null>,
): Map<string, EventAppearance[]> {
  const out = new Map<string, EventAppearance[]>()
  for (const row of rows) {
    if (row.chapterId === forChapterId) continue
    const list = out.get(row.writerEventId) ?? []
    list.push({
      chapterId: row.chapterId,
      chapterTitle: row.chapter.title,
      chapterNumber: numbers.get(row.chapterId) ?? null,
      bookId: row.chapter.bookId,
      bookTitle: row.chapter.book.title,
    })
    out.set(row.writerEventId, list)
  }
  // Stable, readable order: by book, then by chapter number, with unnumbered
  // chapters last rather than sorting as 0 and jumping the prologue.
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        a.bookTitle.localeCompare(b.bookTitle) ||
        (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity) ||
        a.chapterTitle.localeCompare(b.chapterTitle),
    )
  }
  return out
}
