import { prisma } from './prisma'
import { extractText, countWords } from './seriesStats'

// ContentBlock.wordCount is a derived cache: words in content + baseContent
// + every override's content. Write paths keep it fresh via these helpers;
// scripts/backfill-word-counts.mjs recomputes every block from scratch if
// it ever drifts. The stored prose is never derived FROM this — it only
// flows the other way.

export function blockWordCount(block: {
  content?: string | null
  baseContent?: string | null
  overrides?: { content: string | null }[]
}): number {
  const texts = [block.content, block.baseContent, ...(block.overrides ?? []).map(o => o.content)]
  return texts.reduce((sum, t) => sum + countWords(extractText(t)), 0)
}

// Reload the given blocks (with overrides) and rewrite their cached counts.
// Used after writes where the caller doesn't already hold the full picture
// (override create/update/delete, bulk replace, import).
export async function refreshBlockWordCounts(blockIds: string[]): Promise<void> {
  const ids = [...new Set(blockIds)]
  if (ids.length === 0) return
  const rows = await prisma.contentBlock.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      content: true,
      baseContent: true,
      wordCount: true,
      overrides: { select: { content: true } },
    },
  })
  const stale = rows
    .map(r => ({ id: r.id, wordCount: blockWordCount(r), prev: r.wordCount }))
    .filter(r => r.wordCount !== r.prev)
  if (stale.length === 0) return
  await prisma.$transaction(stale.map(r =>
    prisma.contentBlock.update({ where: { id: r.id }, data: { wordCount: r.wordCount } })
  ))
}
