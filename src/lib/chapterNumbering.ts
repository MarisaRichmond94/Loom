// Chapter-title numbering rules, shared by every surface that restructures a
// book: the sidebar's drag-to-reorder and the book page's outline board.
//
// Pure functions, no Prisma, so the rules can be pinned by unit tests and the
// two surfaces cannot drift — two copies of "which titles move when a chapter
// does" is how one of them ends up renumbering a Prologue.
//
// The number in a "Chapter N" title is cosmetic: the manuscript's chapter
// headings come from the canon walk's running counter over `numbered` chapters
// (walk.ts), not from the title. The titles are kept in step anyway because
// they are what the writer sees in the sidebar and on every card.

export const PROLOGUE_TITLE = 'Prologue'
export const EPILOGUE_TITLE = 'Epilogue'
export const CHAPTER_PREFIX = 'Chapter '

/** "Chapter 12" → { prefix: "Chapter ", num: 12 }; "12" → { prefix: "", num: 12 }. */
export function parseNumberedTitle(title: string): { prefix: string; num: number } | null {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return { prefix: '', num: Number(bare[1]) }
  const m = /^(.+\s)(\d+)$/.exec(title)
  if (m) return { prefix: m[1], num: Number(m[2]) }
  return null
}

const isNamed = (title: string, name: string) => title.trim().toLowerCase() === name.toLowerCase()
export const isPrologueTitle = (title: string) => isNamed(title, PROLOGUE_TITLE)
export const isEpilogueTitle = (title: string) => isNamed(title, EPILOGUE_TITLE)

/**
 * Renumbers ONLY chapters whose prefix matches the moved chapter's prefix.
 *
 * Dragging "Bonus Chapter 7" re-sequences "Bonus Chapter N" (1, 2, 3, … in the
 * new order) while every "Chapter N" and one-off ("Prologue", "Epilogue") is
 * left untouched — both their titles AND their numbering. Walking every prefix
 * on every drag was the previous behaviour and caused unrelated prefixes to
 * silently shift when their titles didn't already form a clean sequence.
 */
export function renumberAfterDrag<T extends { title: string }>(chapters: T[], movedTitle: string): T[] {
  const movedParsed = parseNumberedTitle(movedTitle)
  if (!movedParsed) return chapters
  let n = 0
  return chapters.map(c => {
    const parsed = parseNumberedTitle(c.title)
    if (!parsed || parsed.prefix !== movedParsed.prefix) return c
    n++
    return { ...c, title: `${parsed.prefix}${n}` }
  })
}

/**
 * The title a new chapter inserted at `index` should get.
 *
 * One past the last "Chapter N" before it, or "Chapter 1" when there is none
 * (an empty book, or an insert right after the Prologue). The insert route then
 * bumps every later "Chapter N" by one, which is what keeps the sequence whole.
 */
export function nextChapterTitle(chapters: { title: string }[], index: number): string {
  for (let i = Math.min(index, chapters.length) - 1; i >= 0; i--) {
    const parsed = parseNumberedTitle(chapters[i].title)
    if (parsed && parsed.prefix === CHAPTER_PREFIX) return `${CHAPTER_PREFIX}${parsed.num + 1}`
  }
  return `${CHAPTER_PREFIX}1`
}

/**
 * Where a dragged chapter may land, given the pinned ends.
 *
 * A Prologue is always first and an Epilogue always last — that is what the
 * words mean, and the canon export heads the manuscript with whatever is first.
 * So neither end moves, and nothing may be dropped before the one or after the
 * other: the target is clamped inside them rather than refused, because a drop
 * that lands one slot off the end is the writer meaning "the end".
 */
export function clampDropIndex(chapters: { title: string }[], to: number): number {
  const first = chapters.length > 0 && isPrologueTitle(chapters[0].title) ? 1 : 0
  const last =
    chapters.length > 0 && isEpilogueTitle(chapters[chapters.length - 1].title)
      ? chapters.length - 2
      : chapters.length - 1
  return Math.max(first, Math.min(last, to))
}

/** Whether this chapter is pinned in place by its name. */
export function isPinnedChapter(chapters: { title: string }[], index: number): boolean {
  const c = chapters[index]
  if (!c) return false
  return (index === 0 && isPrologueTitle(c.title)) ||
    (index === chapters.length - 1 && isEpilogueTitle(c.title))
}

export type ChapterKind = 'prologue' | 'epilogue' | 'chapter'

type KindInput = { id: string; title: string; order: number }
export type KindUpdate = { id: string; title: string; numbered?: boolean }

/**
 * Turn the first chapter into the Prologue (or back), or the last into the
 * Epilogue (or back), with every title change that implies.
 *
 * Minimal on purpose: only the target and the "Chapter N" titles AFTER it are
 * touched, each by exactly ±1 — the same shift the insert and delete routes
 * make. Re-sequencing the whole book from 1 would also "fix" any drift the
 * writer's titles already had, rewriting chapters nobody asked to change.
 *
 * Returns an error string rather than throwing: every refusal here is a
 * request that no longer matches the book (a stale board, a double click), and
 * the route answers it with a 409.
 */
export function planChapterKindChange(
  chapters: KindInput[],
  targetId: string,
  kind: ChapterKind,
): { updates: KindUpdate[] } | { error: string } {
  const ordered = [...chapters].sort((a, b) => a.order - b.order)
  const index = ordered.findIndex(c => c.id === targetId)
  if (index < 0) return { error: 'chapter is not in this book' }
  const target = ordered[index]
  const isFirst = index === 0
  const isLast = index === ordered.length - 1

  // Every "Chapter N" after the target, shifted by delta.
  const shiftLater = (delta: number): KindUpdate[] =>
    ordered.slice(index + 1).flatMap(c => {
      const parsed = parseNumberedTitle(c.title)
      if (!parsed || parsed.prefix !== CHAPTER_PREFIX) return []
      return [{ id: c.id, title: `${CHAPTER_PREFIX}${parsed.num + delta}` }]
    })

  if (kind === 'prologue') {
    if (!isFirst) return { error: 'only the first chapter can become the prologue' }
    if (isPrologueTitle(target.title)) return { error: 'this chapter is already the prologue' }
    const parsed = parseNumberedTitle(target.title)
    return {
      updates: [
        { id: target.id, title: PROLOGUE_TITLE, numbered: false },
        // Only a "Chapter N" target leaves a hole in the sequence to close.
        ...(parsed?.prefix === CHAPTER_PREFIX ? shiftLater(-1) : []),
      ],
    }
  }

  if (kind === 'epilogue') {
    if (!isLast) return { error: 'only the last chapter can become the epilogue' }
    if (isEpilogueTitle(target.title)) return { error: 'this chapter is already the epilogue' }
    // Nothing comes after the last chapter, so nothing renumbers.
    return { updates: [{ id: target.id, title: EPILOGUE_TITLE, numbered: false }] }
  }

  // Back to an ordinary chapter.
  if (isFirst && isPrologueTitle(target.title)) {
    return {
      updates: [
        { id: target.id, title: `${CHAPTER_PREFIX}1`, numbered: true },
        ...shiftLater(1),
      ],
    }
  }
  if (isLast && isEpilogueTitle(target.title)) {
    return { updates: [{ id: target.id, title: nextChapterTitle(ordered, index), numbered: true }] }
  }
  return { error: 'only the prologue or the epilogue can be turned back into a chapter' }
}
