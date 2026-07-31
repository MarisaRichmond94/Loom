import { prisma } from '@/lib/prisma'
import { getLastTouchedChapter } from '@/lib/authorState'
import { loadManuscriptBook } from '@/lib/manuscript/loadBook'
import { defaultStoryState, walkBook } from '@/lib/manuscript/walk'
import { buildInitialState, serializeSession } from '@/lib/sessionService'

// Shared resolution for the companion-app jump routes (KAN-12).
//
// There are two ways in for each destination: by title (what WriteAI could
// express before it carried Loom ids) and by id (what it uses now). Both do the
// same work once the series/book are known — resume at the last-touched
// chapter, or walk canon and mint a reader session — so that work lives here.
// Duplicating it per route is how the two variants would quietly drift into
// behaving differently, which is worse than either being wrong.
//
// Title resolution is kept indefinitely rather than deprecated: the routes are
// small and read-only, and links already saved in the wild are title-based.

/** Apostrophes and unicode composition are the realistic ways a citation's
 *  title and a DB title drift apart while still "being" the same title. */
export function normalizeTitle(s: string): string {
  return s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
}

/** Series id for a title, or null. SQLite Prisma has no case-insensitive
 *  filter and the list is tiny, so match in memory. */
export async function seriesIdForTitle(title: string): Promise<string | null> {
  const wanted = normalizeTitle(title)
  const all = await prisma.series.findMany({ select: { id: true, title: true } })
  return all.find(s => normalizeTitle(s.title) === wanted)?.id ?? null
}

/** Book id for a title within a series, or null. */
export async function bookIdForTitle(seriesId: string, title: string): Promise<string | null> {
  const wanted = normalizeTitle(title)
  const books = await prisma.book.findMany({
    where: { seriesId },
    select: { id: true, title: true },
  })
  return books.find(b => normalizeTitle(b.title) === wanted)?.id ?? null
}

/**
 * Where an author-side jump should land for a series.
 *
 * Prefers the chapter the writer last opened (the editor stamps it on mount)
 * so the jump resumes work rather than restarting at the outline. Chapters can
 * be deleted after being stamped, so the stamp is only trusted while the
 * chapter still exists in this series.
 */
export async function authorJumpTarget(seriesId: string): Promise<string> {
  const last = await getLastTouchedChapter(seriesId)
  if (!last) return `/author/${seriesId}`
  const chapter = await prisma.chapter.findUnique({
    where: { id: last.chapterId },
    select: { id: true, book: { select: { seriesId: true } } },
  })
  return chapter?.book.seriesId === seriesId
    ? `/author/${seriesId}/chapter/${chapter.id}`
    : `/author/${seriesId}`
}

/**
 * The chapter's canon display number — the address WriteAI knows it by.
 *
 * Mirrors the mapping the canon export returns as `reviewChapter`: a numbered
 * chapter is its number, a literal "Prologue" is 0, and anything else — an
 * unnumbered chapter, or one the canon walk skips — has no address there.
 *
 * Deliberately READ-ONLY. The export endpoint returns the same number, but
 * getting it that way writes the manuscript to ~/Writing; looking up an
 * existing review must not have side effects (KAN-22).
 *
 * Kept beside readerJumpPath because both depend on the walk producing the
 * same numbering the export wrote into the manifest. If one changes, both do.
 */
export async function reviewNumberForChapter(
  seriesId: string,
  bookId: string,
  chapterId: string,
): Promise<number | null> {
  const data = await loadManuscriptBook(seriesId, bookId)
  if (!data) return null
  const walk = walkBook(data.chapters, data.variables, defaultStoryState(data.variables), {})
  const walked = walk.chapters.find(ch => ch.id === chapterId)
  if (!walked) return null
  if (walked.numbered) return Number(walked.label)
  return walked.label.trim().toLowerCase() === 'prologue' ? 0 : null
}

/**
 * Resolve a *display* chapter number to the reader deep link for it.
 *
 * The number is the counter that skips unnumbered chapters (prologue = 0), NOT
 * Loom's Chapter.order. Walking with walkBook is what guarantees the number
 * matched here is byte-for-byte the one the canon export wrote into the
 * manifest and WriteAI ingested.
 *
 * Returns null when the chapter can't be resolved — callers fall back to the
 * book preview rather than 404ing.
 */
export async function readerJumpPath(
  seriesId: string,
  bookId: string,
  chapterNumber: number,
): Promise<string | null> {
  if (!Number.isInteger(chapterNumber)) return null

  const data = await loadManuscriptBook(seriesId, bookId)
  if (!data) return null

  // Pure canon walk (every variable at its default) — the same walk that
  // produced the numbering WriteAI read back from the manifest.
  const walk = walkBook(data.chapters, data.variables, defaultStoryState(data.variables), {})
  const target = walk.chapters.find(ch => {
    const number = ch.numbered
      ? Number(ch.label)
      : (ch.label.trim().toLowerCase() === 'prologue' ? 0 : null)
    return number === chapterNumber
  })
  if (!target) return null

  // Fresh reader session (mirrors POST /api/sessions). The reader page seeds
  // state to reveal gated chapters on a fresh session, so this lands on the
  // cited chapter's text even when it is conditional.
  const variables = await prisma.storyVariable.findMany({ where: { seriesId } })
  const { storyState, choiceHistory } = serializeSession(buildInitialState(variables), [])
  const session = await prisma.readerSession.create({
    data: { seriesId, currentBlockId: null, storyState, choiceHistory },
  })
  return `/read/${session.id}?startChapterId=${encodeURIComponent(target.id)}`
}
