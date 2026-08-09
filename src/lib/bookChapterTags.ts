// The book's chapter sequence, with its character and event tags (LOOM-120/121).
//
// The INVERSE of the existing tag views. chapterEvents/chapterCharacters answer
// "which chapters is this thing in?" — one entity, its spread. This answers
// "what is in each chapter?", walking the book in order, because the question
// behind the tickets is spatial: *where does Chase appear, and how big are the
// gaps between?* A per-entity spread cannot show a gap; only the full sequence
// can.
//
// ⚠️ This walks LOOM's chapter list, not WriteAI's outline, and that is the
// whole point of the design. The outline is WriteAI's store and holds canon
// only: at the time of writing, 343 Loom chapters map to 334 outline cards, and
// the 9 with no card are exactly the Bonus Chapters — branch-gated, so the canon
// walk never reaches them and no card is ever seeded. Building this over the
// outline would silently drop precisely the chapters the tickets asked to see.
// Summaries are joined onto this list read-only, never the other way round.

/** One chapter's tags, as the route reads them from either join table. */
export type TagRow = {
  chapterId: string
  /** The WriteAI id — `wc-…` for a character, `we-…` for an event. */
  entityId: string
  /** This tag is on a NON-CANON branch (LOOM-63). Distinct from the chapter
   *  itself being off-canon: a character can appear on a branch *within* a
   *  chapter that is otherwise canon. */
  nonCanon: boolean
}

/** A chapter as it comes out of the DB, before numbering. */
export type ChapterIn = {
  id: string
  title: string
  order: number
  /** The writer's own summary (ChapterSummary), absent for the great majority
   *  of chapters, which take theirs from WriteAI's outline card instead. */
  manualSummary?: string | null
  /** Loom's own copy of POV/date, set at import time. For a Bonus Chapter this
   *  is the ONLY source there will ever be — it has no outline card to join
   *  against. For a canon chapter it is a snapshot, not live: editing the
   *  Outline tab's POV/date writes WriteAI's card only, never back to this
   *  column, so a canon row's card values (joined client-side) take priority
   *  over these whenever both exist. */
  pov?: string | null
  date?: string | null
}

export type TaggedEntity = {
  id: string
  nonCanon: boolean
}

/** One chapter in the book's sequence, with everything tagged to it. */
export type BookChapterRow = {
  chapterId: string
  /**
   * The DISPLAY label, verbatim from `Chapter.title`.
   *
   * Deliberately the authored title and not a derived "Chapter N": this is
   * exactly what the left-hand sidebar renders (OutlineTree.tsx:88), and
   * matching it is the whole ask — a branch chapter has to read as "Bonus
   * Chapter 1", which no numbering scheme would ever produce, since the canon
   * walk never assigns it a number at all.
   *
   * Verified against production when this shipped: for all 334 chapters that
   * DO have a canon number, the authored title agreed with it exactly, so
   * showing the title costs nothing in consistency with the Outline tab.
   */
  title: string
  order: number
  /** Canon display number (0 = prologue), or null where there is none. */
  chapterNumber: number | null
  /**
   * The canon walk never reaches this chapter — it sits behind a choice.
   *
   * Derived from ABSENCE in the numbers map, not from a null number, and the
   * two are genuinely different: a named-but-visited chapter (a prologue that
   * is not literally titled "Prologue") is *in* the map with a null number,
   * while a branch chapter is not in the map at all. Conflating them would
   * badge ordinary named chapters as branch content.
   */
  offCanon: boolean
  /**
   * The writer's own summary, or null.
   *
   * Only branch chapters are expected to carry one — they are the chapters with
   * no outline card and no way to get one. Kept as its own field rather than
   * merged with the WriteAI summary on the server, because the client must be
   * able to tell them apart: one is editable in place and the other is a
   * read-only join it must never write back through.
   */
  manualSummary: string | null
  /** Loom's own POV/date (Chapter.pov / Chapter.date). The only source for a
   *  Bonus Chapter; a stale-tolerated fallback for a canon one, since the
   *  outline card joined client-side reflects the writer's latest edit and
   *  this column does not. */
  pov: string | null
  date: string | null
  characters: TaggedEntity[]
  events: TaggedEntity[]
}

/**
 * Collapse a book's chapters and its two tag tables into one ordered sequence.
 *
 * Ordered by `Chapter.order` — the author's own arrangement — rather than by
 * canon number. Canon numbering skips branch chapters entirely, so ordering by
 * it would either drop them or pile them at the end; `order` is the only
 * sequence in which a Bonus Chapter sits where the author actually put it,
 * which is what makes the spacing readable.
 *
 * `numbers` is the canon WALK's output (canonNumbersForBook). A chapter missing
 * from it is off-canon; a chapter mapped to null is on canon with no number.
 *
 * Tags for chapters outside `chapters` are ignored rather than dropped
 * silently-but-differently: the caller queries both by the same bookId, so a
 * stray row is a caller bug, not data to preserve.
 */
export function groupBookChapterTags(
  chapters: ChapterIn[],
  characterRows: TagRow[],
  eventRows: TagRow[],
  numbers: Map<string, number | null>,
): BookChapterRow[] {
  const byChapter = new Map<string, { characters: TaggedEntity[]; events: TaggedEntity[] }>()
  for (const c of chapters) byChapter.set(c.id, { characters: [], events: [] })

  const collect = (rows: TagRow[], pick: (b: { characters: TaggedEntity[]; events: TaggedEntity[] }) => TaggedEntity[]) => {
    for (const row of rows) {
      const bucket = byChapter.get(row.chapterId)
      if (!bucket) continue // a tag on a chapter outside this book
      const list = pick(bucket)
      // A chapter can legitimately carry the same id twice only through a
      // duplicate row; keep the first and let the canon flag win if either
      // says canon, since "appears in the real story" is the weaker claim to
      // discard.
      const existing = list.find(e => e.id === row.entityId)
      if (existing) {
        existing.nonCanon = existing.nonCanon && row.nonCanon
        continue
      }
      list.push({ id: row.entityId, nonCanon: row.nonCanon })
    }
  }
  collect(characterRows, b => b.characters)
  collect(eventRows, b => b.events)

  return [...chapters]
    .sort((a, b) => a.order - b.order)
    .map(c => {
      const bucket = byChapter.get(c.id)!
      return {
        chapterId: c.id,
        title: c.title,
        order: c.order,
        chapterNumber: numbers.get(c.id) ?? null,
        offCanon: !numbers.has(c.id),
        manualSummary: c.manualSummary ?? null,
        pov: c.pov ?? null,
        date: c.date ?? null,
        characters: bucket.characters,
        events: bucket.events,
      }
    })
}

/**
 * The gap, in chapters, between each match and the previous one.
 *
 * Returned alongside the rows rather than computed in the component because it
 * is the actual answer to "I need to see all the chapters Chase is in" — the
 * run lengths between appearances are the signal, and an off-by-one here reads
 * as a story problem rather than a display bug.
 *
 * Index i holds how many NON-matching chapters immediately precede match i.
 * The leading run (before the first match) is included, so a character who
 * first appears in chapter 12 reports 11 rather than 0.
 */
export function matchGaps(rows: BookChapterRow[], matches: (row: BookChapterRow) => boolean): number[] {
  const gaps: number[] = []
  let run = 0
  for (const row of rows) {
    if (matches(row)) {
      gaps.push(run)
      run = 0
    } else {
      run += 1
    }
  }
  return gaps
}
