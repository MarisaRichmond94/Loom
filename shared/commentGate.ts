/**
 * Who may see a chapter's comments (LOOM-134).
 *
 * Placement — below the end marker, collapsed — stops you catching chapter 7's
 * comments while you are still reading chapter 7. It does NOT stop someone
 * jumping to the bottom via the chapter list, or opening the URL directly. This
 * is the rule that makes the placement real rather than a layout convention.
 *
 * THE THREAT IS NOT MALICE. It is your mother, three chapters ahead of your
 * husband, writing "I can't believe he actually did it" on chapter 7 — with
 * chapter 12 in mind. Nobody is attacking anything; the spoiler arrives through
 * ordinary use, which is exactly why it needs a mechanism and not a convention.
 *
 * Pure: the caller supplies the ordered chapter ids and a paragraph count, so
 * this is testable without a snapshot and cannot query one by accident.
 */

export type GateInput = {
  /** The book's chapters, IN PUBLISHED ORDER. */
  chapterIds: string[]
  /** The chapter whose comments are being requested. */
  chapterId: string
  /** Where the viewer's own progress currently sits, or null if unstarted. */
  atChapterId: string | null
  /** Paragraph index within `atChapterId`. */
  atOffset: number
  /** How many paragraphs `chapterId` has. 0 for a chapter with no prose. */
  paragraphCount: number
}

/**
 * Has this viewer finished the chapter they are asking about?
 *
 * Two ways to qualify, and the first is the common one:
 *
 *   1. Their position is in a LATER chapter — they moved on, so they finished.
 *   2. Their position is in THIS chapter, at or past its final paragraph.
 *
 * Reaching the end is an EXPLICIT signal, not a scroll heuristic. When the end
 * of the prose comes into view the recorder writes an offset equal to the
 * chapter's paragraph count — one past the last index. A heuristic could not do
 * this job: the recorded offset is the topmost paragraph above the reading
 * line, so on a tall viewport the final recorded index at the true bottom of a
 * chapter sits several short of the end, by an amount that depends on the
 * reader's screen. Any fixed slack would be wrong for somebody.
 *
 * The one paragraph of tolerance below absorbs a different thing: the client
 * counts rendered <p> elements and the server counts them in the stored HTML,
 * and those two counters disagreeing by one must not lock a reader out.
 */
export function hasFinishedChapter(input: GateInput): boolean {
  const { chapterIds, chapterId, atChapterId, atOffset, paragraphCount } = input

  // Never started the book: nothing is finished.
  if (!atChapterId) return false

  const target = chapterIds.indexOf(chapterId)
  const at = chapterIds.indexOf(atChapterId)

  // A chapter that is not in the published order cannot be reasoned about. Fail
  // CLOSED — the cost of a wrong "no" is a reader clicking again later; the
  // cost of a wrong "yes" is the spoiler this whole file exists to prevent.
  if (target < 0 || at < 0) return false

  if (at > target) return true
  if (at < target) return false

  // Same chapter. A chapter with no prose has nothing to finish.
  if (paragraphCount <= 0) return true
  return atOffset >= paragraphCount - 1
}

/**
 * What to show someone who has not finished yet.
 *
 * Deliberately does not say how many comments there are. A count is itself a
 * signal — "seven comments on this chapter" tells you something happens here —
 * and the whole point is that nothing about the discussion reaches a reader who
 * has not arrived.
 */
export const NOT_YET_NOTICE =
  'Comments open up once you’ve finished the chapter.'

/** Shown beside the composer. Convention does the rest in a household this size. */
export const PACE_NUDGE =
  'Others may not be this far yet — try to keep later chapters out of it.'
