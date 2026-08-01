import {
  compareAppearances,
  parseIdList,
  parseTaggedId,
  type ChapterAppearance,
} from './chapterTags'

// Chapter ↔ WriteAI writer-character tags (LOOM-33).
//
// The sibling of chapterEvents. Loom stores only the `wc-` id; the character
// itself lives in WriteAI. The shared validation and ordering live in
// chapterTags so the two tabs cannot drift apart.
//
// Why this exists at all: WriteAI can say which BOOKS a character is in
// (`books`, matched by title) but never which chapters. Chapter-level presence
// is a thing only Loom can know, and only if it is keyed by something that
// survives a chapter being inserted above it.

export type CharacterAppearance = ChapterAppearance

export type TaggedCharacter = {
  writerCharacterId: string
  taggedAt: string
  /** Other chapters this character appears in — never includes the chapter
   *  being asked about. */
  alsoIn: CharacterAppearance[]
}

/** Validate a POST body down to the one field we store. */
export function parseWriterCharacterId(payload: unknown): { id: string } | { error: string } {
  return parseTaggedId(payload, 'wc-', 'writerCharacterId')
}

/** Split the `characterIds` query param for the resolution endpoint. */
export function parseCharacterIds(param: string | null, max = 500): string[] {
  return parseIdList(param, 'wc-', max)
}

/** One ChapterCharacter row joined to its chapter and book. */
export type SpreadRow = {
  writerCharacterId: string
  chapterId: string
  chapter: {
    title: string
    bookId: string
    book: { title: string }
  }
}

/**
 * Group every tag for a set of characters into per-character appearance
 * lists, leaving out `forChapterId` itself.
 *
 * Split from the query because the interesting cases — appears only here,
 * appears across two books, appears in a chapter with no canon number — are
 * all shape, not SQL.
 */
export function groupAppearances(
  rows: SpreadRow[],
  forChapterId: string,
  numbers: Map<string, number | null>,
): Map<string, CharacterAppearance[]> {
  const out = new Map<string, CharacterAppearance[]>()
  for (const row of rows) {
    if (row.chapterId === forChapterId) continue
    const list = out.get(row.writerCharacterId) ?? []
    list.push({
      chapterId: row.chapterId,
      chapterTitle: row.chapter.title,
      chapterNumber: numbers.get(row.chapterId) ?? null,
      bookId: row.chapter.bookId,
      bookTitle: row.chapter.book.title,
    })
    out.set(row.writerCharacterId, list)
  }
  for (const list of out.values()) list.sort(compareAppearances)
  return out
}

/** One chapter a character appears in, denormalised for WriteAI to render
 *  without resolving anything itself. */
export type ChapterLink = CharacterAppearance & {
  seriesId: string
  seriesTitle: string
  /** Reader deep link, RELATIVE — WriteAI prefixes VITE_LOOM_URL, since Loom
   *  cannot know its own external origin. Null when there is no canon number
   *  to address. */
  readPath: string | null
}

/** Row shape the resolution endpoint reads, joined up to the series. */
export type LinkRow = {
  writerCharacterId: string
  chapterId: string
  chapter: {
    title: string
    bookId: string
    book: { title: string; seriesId: string; series: { title: string } }
  }
}

/**
 * Group tag rows into per-character chapter links.
 *
 * Every requested id gets a key, including ids with no tags — an empty array
 * is a meaningful answer ("appears nowhere yet"), and omitting the key would
 * make the caller guess whether that or a lookup failure was meant.
 */
export function buildChapterLinks(
  ids: string[],
  rows: LinkRow[],
  numbers: Map<string, number | null>,
): Record<string, ChapterLink[]> {
  const out: Record<string, ChapterLink[]> = {}
  for (const id of ids) out[id] = []
  for (const row of rows) {
    const list = out[row.writerCharacterId]
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
  for (const list of Object.values(out)) list.sort(compareAppearances)
  return out
}
