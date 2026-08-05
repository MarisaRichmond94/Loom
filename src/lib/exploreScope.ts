// What the Explore tab is allowed to search, and who appears in it (LOOM-112).
//
// PURE. No prisma, no fetch. The data access lives in exploreScopeServer.ts and
// hands its results here.
//
// The split is not tidiness: this file holds the CLAMP — the rule that stops a
// book page answering out of a later book — and a rule that cannot be unit
// tested is a rule nobody checks. Loom's generated Prisma client is ESM and
// will not load under Jest, so anything importing it is untestable here.
//
// ── The rule ────────────────────────────────────────────────────────────────
//
//   series page → every book in the series
//   book page   → that book and every book BEFORE it, by Loom's `Book.order`
//
// The book-page rule exists because Explore answers from prose. Standing on
// book 3 and getting an answer sourced from book 5 spoils the writer's own
// series back to her, in a way that reads exactly like a correct answer.
//
// ── Identity across the seam ────────────────────────────────────────────────
//
// Loom knows books by cuid, WriteAI by a positional `book_number` assigned at
// ingest. They are joined on the TITLE (see exploreScopeServer.ts). Do NOT
// join `Book.order` to `book_number` — they agree today only because nobody
// has inserted a book, and the day someone does, every answer silently comes
// from the wrong one.

/** A book the page may draw on, with its WriteAI address if it has one. */
export type ExploreBook = {
  /** Loom's cuid — what the client sends back. */
  id: string
  title: string
  /** Loom reading order. Drives the book-page prefix rule. */
  order: number
  /** WriteAI's positional number, or null when it has not ingested this book. */
  writeaiNumber: number | null
}

/** A POV appearing in the allowed books, with how much of them it covers. */
export type ExplorePov = {
  name: string
  /** Chapters narrated from this POV across the allowed books. */
  chapterCount: number
  /** Loom book ids this POV appears in — lets the bar re-derive on narrowing. */
  bookIds: string[]
}

export type ExploreScope = {
  books: ExploreBook[]
  povs: ExplorePov[]
  /** WriteAI's last ingest time, for the staleness banner (LOOM-117). */
  lastSynced: string | null
}

/** One row of WriteAI's `GET /api/books`, reduced to what this needs. */
export type WriteAiBookRow = {
  id?: number
  name?: string
  chapters?: { chapter?: number; pov?: string | null }[]
}

/**
 * WriteAI reports this as a POV for chapters whose narrator it could not
 * determine. It is not a character, and offering it in a character filter
 * reads as one — `The Secrets We Keep` carries one such chapter today. Those
 * chapters stay searchable; they are just not selectable BY POV.
 */
const NOT_A_POV = new Set(['unknown', 'none', 'n/a', ''])

/**
 * Book-title normalisation for the cross-app join.
 *
 * Same rule as `writeaiBooks.ts` — kept here rather than imported so this
 * module stays free of the prisma import that file carries. The two are pinned
 * as identical by test, because two lookups that disagree about what counts as
 * the same title is a bug that shows up on exactly one book.
 */
export const normBookTitle = (s: string) =>
  s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()

/**
 * Assemble the scope from Loom's books and WriteAI's index.
 *
 * `loomBooks` must already be narrowed to what the page allows — the prefix
 * rule is applied by the caller, which is the only place that knows whether
 * this is a book page or a series page.
 */
export function buildScope(
  loomBooks: { id: string; title: string; order: number }[],
  writeaiRows: WriteAiBookRow[],
  lastSynced: string | null,
): ExploreScope {
  const byTitle = new Map<string, WriteAiBookRow>()
  for (const row of writeaiRows) {
    if (typeof row.name === 'string') byTitle.set(normBookTitle(row.name), row)
  }

  const books: ExploreBook[] = loomBooks.map(b => {
    const row = byTitle.get(normBookTitle(b.title))
    return {
      id: b.id,
      title: b.title,
      order: b.order,
      writeaiNumber: typeof row?.id === 'number' ? row.id : null,
    }
  })

  // POVs are derived from the allowed books only, and recomputed whenever the
  // book selection narrows — a POV appearing in no selected book must not be
  // offerable. Sourced from `GET /api/books`, a pure sqlite read.
  //
  // ⚠️ NOT from the plan-characters endpoint, which seeds, prunes and SAVES on
  // a GET (INTEGRATION.md §5). A character list is precisely the thing that
  // reaches for it by instinct.
  const tally = new Map<string, { chapters: number; bookIds: Set<string> }>()
  for (const book of books) {
    if (book.writeaiNumber === null) continue
    const row = byTitle.get(normBookTitle(book.title))
    for (const ch of row?.chapters ?? []) {
      const pov = (ch.pov ?? '').trim()
      if (!pov || NOT_A_POV.has(pov.toLowerCase())) continue
      const entry = tally.get(pov) ?? { chapters: 0, bookIds: new Set<string>() }
      entry.chapters += 1
      entry.bookIds.add(book.id)
      tally.set(pov, entry)
    }
  }

  const povs: ExplorePov[] = [...tally.entries()]
    .map(([name, v]) => ({ name, chapterCount: v.chapters, bookIds: [...v.bookIds] }))
    // Most-narrated first, then alphabetical — the ordering WriteAI's own
    // filter bar uses, so a writer moving between the apps sees one order.
    .sort((a, b) => b.chapterCount - a.chapterCount || a.name.localeCompare(b.name))

  return { books, povs, lastSynced }
}

/** True when WriteAI has ingested none of the books this page allows. */
export function isUnindexed(scope: ExploreScope): boolean {
  return scope.books.every(b => b.writeaiNumber === null)
}

/**
 * Intersect what the client asked for with what the page allows.
 *
 * Returns WriteAI book NUMBERS, ready for `book_filter`. Books the page does
 * not allow are dropped rather than rejected: the question is still
 * answerable, just narrower, and a 400 here would turn a stale browser tab
 * into a broken feature.
 *
 * An empty or absent selection means "everything allowed" — the same
 * convention WriteAI's filter bar uses, where no selection means no filter.
 */
export function clampBookSelection(
  scope: ExploreScope,
  requestedBookIds: unknown,
): number[] {
  const addressable = scope.books.filter(b => b.writeaiNumber !== null)
  if (!Array.isArray(requestedBookIds) || requestedBookIds.length === 0) {
    return addressable.map(b => b.writeaiNumber as number)
  }
  const wanted = new Set(requestedBookIds.filter(id => typeof id === 'string'))
  const kept = addressable.filter(b => wanted.has(b.id))
  // The dangerous case. A selection naming only forbidden books would
  // otherwise send an EMPTY filter, which WriteAI reads as "the whole series"
  // — handing back exactly the spoiler this function exists to prevent.
  return (kept.length ? kept : addressable).map(b => b.writeaiNumber as number)
}

/** Keep only POVs that actually exist in the allowed books. */
export function clampPovSelection(
  scope: ExploreScope,
  requestedPovs: unknown,
): string[] {
  if (!Array.isArray(requestedPovs) || requestedPovs.length === 0) return []
  const available = new Set(scope.povs.map(p => p.name))
  return requestedPovs.filter(
    (p): p is string => typeof p === 'string' && available.has(p),
  )
}
