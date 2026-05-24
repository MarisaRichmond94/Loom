// Shared stat helpers used by /api endpoints that surface counts. Pulled
// out of /api/series/[seriesId]/books/[bookId]/route.ts so series-level
// aggregation can reuse the same word-counting walk over TipTap JSON.

// Walks a TipTap JSON tree (stored as a string) and concatenates every
// text node it finds. Used as the basis for word counts; returns '' for
// null/invalid input so callers can blindly count.
export function extractText(json: string | null | undefined): string {
  if (!json) return ''
  try {
    const walk = (node: Record<string, unknown>): string => {
      if (node.type === 'text') return (node.text as string) ?? ''
      const children = (node.content as Record<string, unknown>[] | undefined) ?? []
      return children.map(walk).join(' ')
    }
    return walk(JSON.parse(json))
  } catch { return '' }
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

type Block = {
  type: string
  content: string | null
  baseContent: string | null
  choices?: { id: string }[]
  overrides?: { content: string }[]
}
type Chapter = { pov: string | null; blocks: Block[] }
type Book = { chapters: Chapter[] }

export type SeriesAggregateStats = {
  bookCount: number
  uniquePovs: number
  choiceCount: number
  wordCount: number
}

// Aggregates the four headline stats across every book in a series.
// Mirrors the per-book computation in /api/series/[seriesId]/books/[bookId]
// but unioned across books.
export function computeSeriesStats(books: Book[]): SeriesAggregateStats {
  const allChapters = books.flatMap(b => b.chapters)
  const allBlocks = allChapters.flatMap(c => c.blocks)
  const uniquePovs = new Set(allChapters.map(c => c.pov).filter((p): p is string => !!p)).size
  const choiceCount = allBlocks
    .filter(b => b.type === 'choice_point')
    .reduce((sum, b) => sum + (b.choices?.length ?? 0), 0)
  const wordCount = allBlocks.reduce((sum, b) => {
    const texts = [
      b.content,
      b.baseContent,
      ...((b.overrides ?? []).map(o => o.content)),
    ]
    return sum + texts.reduce((ws, t) => ws + countWords(extractText(t)), 0)
  }, 0)
  return { bookCount: books.length, uniquePovs, choiceCount, wordCount }
}
