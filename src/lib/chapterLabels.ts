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
  chapters: ChapterIn[]
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
    let counter = 0
    for (const chapter of [...book.chapters].sort((a, b) => a.order - b.order)) {
      const visible = isChapterVisible(chapter, storyState)
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
    const parsed = JSON.parse(chapter.condition) as Record<string, boolean | number | string>
    return matchesCondition(parsed, storyState)
  } catch {
    return true
  }
}
