import { matchesCondition, type StoryState } from './storyEngine'

export type ChapterIn = {
  id: string
  title: string
  order: number
  condition?: string | null
  numbered?: boolean
}

export type BookIn = {
  id: string
  title: string
  order: number
  /** Reader gate — same JSON grammar as ChapterIn.condition (LOOM-151). */
  condition?: string | null
  /** Series-level canon membership. Non-canon books label as "Alt". */
  canon?: boolean
  chapters: ChapterIn[]
}

export type BookLabel = {
  bookId: string
  /** Does this reader's story state qualify them for this book? */
  visible: boolean
  /** "Book 3" for a canon book, "Alt" for a non-canon one. */
  readerLabel: string
  authoredTitle: string
}

export type ChapterLabel = {
  chapterId: string
  visible: boolean
  readerLabel: string
  authoredTitle: string
}

/**
 * Walks every chapter in every book and produces a reader-facing label map keyed by chapter id.
 * - A chapter is visible when it has no condition OR its condition matches the current storyState.
 * - Visible chapters with numbered=true get a running "Chapter N" label scoped to their book.
 *   Named chapters (numbered=false) and hidden chapters do NOT advance the counter.
 * - Named chapters render their authored title verbatim (Prologue, Epilogue, etc.).
 * - Hidden chapters still get an entry so callers can check `visible` without missing keys.
 */
export function computeChapterLabels(books: BookIn[], storyState: StoryState): Record<string, ChapterLabel> {
  const map: Record<string, ChapterLabel> = {}
  for (const book of [...books].sort((a, b) => a.order - b.order)) {
    // A chapter in a book this reader does not qualify for is not visible,
    // whatever its own condition says (LOOM-151). Entries are still emitted —
    // callers check `visible` and must not hit a missing key.
    const bookVisible = isBookVisible(book, storyState)
    let counter = 0
    for (const chapter of [...book.chapters].sort((a, b) => a.order - b.order)) {
      const visible = bookVisible && isChapterVisible(chapter, storyState)
      const numbered = chapter.numbered !== false
      let readerLabel = chapter.title
      if (visible && numbered) {
        counter += 1
        readerLabel = `Chapter ${counter}`
      }
      map[chapter.id] = {
        chapterId: chapter.id,
        visible,
        readerLabel,
        authoredTitle: chapter.title,
      }
    }
  }
  return map
}

export function isChapterVisible(chapter: ChapterIn, storyState: StoryState): boolean {
  if (!chapter.condition) return true
  try {
    const parsed = JSON.parse(chapter.condition)
    return matchesCondition(parsed, storyState)
  } catch {
    return true
  }
}

/**
 * Is this book open to a reader in this story state? (LOOM-151, under LOOM-146)
 *
 * The exact sibling of isChapterVisible, one level up, including its failure
 * mode: an unparseable condition returns TRUE. Hiding a book because its gate
 * failed to parse would silently remove a chunk of the story, which is far
 * worse than showing one that should have been gated.
 */
export function isBookVisible(book: BookIn, storyState: StoryState): boolean {
  if (!book.condition) return true
  try {
    return matchesCondition(JSON.parse(book.condition), storyState)
  } catch {
    return true
  }
}

/**
 * Reader-facing labels for a series' books.
 *
 * ⚠️ NUMBERING COUNTS CANON BOOKS ONLY, and is therefore INDEPENDENT OF STORY
 * STATE — a book's number can never change under a reader mid-read.
 *
 * The tempting version is a running counter over *visible* books, so that an
 * alt book replacing canon book 4 also reads as "Book 4". That was considered
 * and rejected: it renumbers the series as you make choices, so a reader who
 * rewinds watches "Book 4" become a different book. Non-canon books get "Alt"
 * instead, which needs no counter and cannot drift.
 *
 * Hidden books still get an entry, for the same reason chapters do.
 */
export function computeBookLabels(books: BookIn[], storyState: StoryState): Record<string, BookLabel> {
  const map: Record<string, BookLabel> = {}
  let counter = 0
  for (const book of [...books].sort((a, b) => a.order - b.order)) {
    const canon = book.canon !== false
    // Counted before visibility is considered — that is what makes the number
    // stable across choices.
    if (canon) counter += 1
    map[book.id] = {
      bookId: book.id,
      visible: isBookVisible(book, storyState),
      readerLabel: canon ? `Book ${counter}` : 'Alt',
      authoredTitle: book.title,
    }
  }
  return map
}
