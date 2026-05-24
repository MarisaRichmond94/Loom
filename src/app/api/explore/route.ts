import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Reader-facing series feed. Returns one row per series that has at least
// one published book, enriched with what the Explore grid actually needs:
// the first published book's cover (as the hero), how many books are
// published, and the parsed genre/keyword arrays. Series with no published
// books are omitted so drafts don't leak into the public catalog.
export async function GET() {
  const allSeries = await prisma.series.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      books: {
        where: { published: true },
        orderBy: { order: 'asc' },
        select: { id: true, coverPath: true },
      },
    },
  })

  const parseList = (s: string): string[] => {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
  }

  const explorable = allSeries
    .filter(s => s.books.length > 0)
    .map(s => ({
      id: s.id,
      title: s.title,
      description: s.description,
      genres: parseList(s.genres),
      keywords: parseList(s.keywords),
      // First published book's cover is the series' hero on the Explore
      // grid. Falls back to null when none of the published books has a
      // cover uploaded yet — the card renders a placeholder tile.
      heroCoverPath: s.books.find(b => b.coverPath)?.coverPath ?? null,
      publishedBookCount: s.books.length,
    }))

  return NextResponse.json(explorable)
}
