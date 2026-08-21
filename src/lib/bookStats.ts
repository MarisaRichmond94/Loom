// Derived from what AuthorLayout's series fetch already carries (chapters
// with pov, and lean per-block wordCount/choice counts — see
// GET /api/series/[seriesId] and authorContext.tsx) — no separate fetch.
// Shared by the series page's book cards and the book detail page, both of
// which used to re-fetch a deep per-book include just for these four numbers.
export function bookStats(book: { chapters: { pov?: string | null; blocks: { wordCount: number; _count: { choices: number } }[] }[] }) {
  const chapterCount = book.chapters.length
  const wordCount = book.chapters.reduce((s, c) => s + c.blocks.reduce((s2, b) => s2 + b.wordCount, 0), 0)
  const uniquePovs = new Set(book.chapters.map(c => c.pov).filter(Boolean)).size
  const choiceCount = book.chapters.reduce((s, c) => s + c.blocks.reduce((s2, b) => s2 + b._count.choices, 0), 0)
  return { chapterCount, wordCount, uniquePovs, choiceCount }
}
