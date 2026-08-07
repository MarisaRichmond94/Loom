/**
 * Where does a saved position actually land? (LOOM-133)
 *
 * Republishing can remove the chapter a reader was standing in — deleted in
 * Loom, unpublished, or no longer canon-reachable after a choice-point change.
 * The row survives pointing at nothing, because progress joins content.db by
 * cuid across FILES and there is no foreign key to refuse the write.
 *
 * BY ID, NEVER BY NUMBER. Chapter numbers come from the canon walk and shift
 * whenever a chapter is inserted or unpublished; ids do not. Resolving by
 * number would produce a position that looks entirely plausible and points at
 * the wrong chapter — the same class of failure as the WriteAI stale
 * identity-map incident, where a text↔id divorce passed every check that
 * compared id to number.
 *
 * WHY THE POSITION CARRIES ITS OWN PREDECESSOR. The author's rule is "drop the
 * reader to the start of the PREVIOUS chapter". Once a chapter is deleted, its
 * place in the old order is gone with it — nothing left in the snapshot says
 * what used to precede it. So the predecessor is recorded when the position is
 * SAVED, while it is still knowable, rather than reconstructed afterwards from
 * a number that no longer means anything.
 *
 * Pure on purpose: the caller supplies the book's chapters in published order,
 * so this is testable without a snapshot and cannot accidentally query one.
 */

export type ChapterRef = { id: string }

export type Resume =
  /** The chapter is still there; carry on where they left off. */
  | { kind: 'exact'; chapterId: string; offset: number }
  /** Their chapter is gone; they land at the top of the one before it. */
  | { kind: 'previous'; chapterId: string; offset: 0 }
  /** Their chapter is gone and no usable predecessor survives; start of the book. */
  | { kind: 'restart'; chapterId: string; offset: 0 }
  /** The book itself is gone from the snapshot. Surface nothing; drop the row. */
  | { kind: 'gone' }

export type SavedPosition = {
  chapterId: string | null
  offset: number
  /** The chapter that preceded `chapterId` when the position was saved. */
  prevChapterId: string | null
}

/**
 * @param chapters The book's chapters IN PUBLISHED ORDER. Empty means the book
 *   is no longer in the snapshot.
 */
export function resolveResume(chapters: ChapterRef[], saved: SavedPosition): Resume {
  // 4. Book gone entirely.
  if (chapters.length === 0) return { kind: 'gone' }

  const has = (id: string | null): id is string =>
    !!id && chapters.some(c => c.id === id)

  // 1. Chapter still present → resume exactly.
  if (has(saved.chapterId)) {
    return { kind: 'exact', chapterId: saved.chapterId, offset: Math.max(0, saved.offset) }
  }

  // A reader who has never opened the book has no chapter and no predecessor.
  // That is the start of the book, and it is not a relocation — saying "your
  // chapter was revised" to someone who never had one would be a lie.
  if (!saved.chapterId) {
    return { kind: 'restart', chapterId: chapters[0].id, offset: 0 }
  }

  // 2. Chapter gone → start of the chapter that preceded it, if that one
  //    survived. Not chained: if the predecessor is gone too, we stop guessing
  //    rather than walking backwards through a history we no longer have.
  if (has(saved.prevChapterId)) {
    return { kind: 'previous', chapterId: saved.prevChapterId, offset: 0 }
  }

  // 3. No usable predecessor (they were in chapter one, or it went too).
  return { kind: 'restart', chapterId: chapters[0].id, offset: 0 }
}

/**
 * What to tell the reader.
 *
 * Only when they were actually moved. A silent jump reads as a bug and invites
 * them to think they lost their place — but announcing a "revision" to someone
 * opening a book for the first time is just as wrong, which is why `restart`
 * distinguishes the two cases by whether a chapter was saved at all.
 */
export function resumeNotice(r: Resume, hadSavedChapter: boolean): string | null {
  if (!hadSavedChapter) return null
  switch (r.kind) {
    case 'exact':
    case 'gone':
      return null
    case 'previous':
      return 'That chapter was revised, so you’re back at the start of the one before it.'
    case 'restart':
      return 'That chapter was revised, so you’re back at the beginning of the book.'
  }
}
