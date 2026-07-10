import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runSearch } from './search'

type Params = { params: Promise<{ seriesId: string }> }

// GET /api/series/[seriesId]/search?q=<query>&bookIds=<csv>
//
// Returns hits across prose, prompts, choice text, override content,
// and chapter titles. `bookIds` is a comma-separated allowlist; omit
// or leave blank to search every book in the series. Empty `q` short-
// circuits to an empty array so the UI can submit a cleared input
// without paying for the walk.
export async function GET(req: Request, { params }: Params) {
  const { seriesId } = await params
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const bookIdsParam = url.searchParams.get('bookIds')
  const bookIds = bookIdsParam ? bookIdsParam.split(',').filter(Boolean) : null
  const opts = {
    caseSensitive: url.searchParams.get('caseSensitive') === '1',
    wholeWord: url.searchParams.get('wholeWord') === '1',
  }

  if (!q.trim()) return NextResponse.json({ hits: [] })

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      books: {
        orderBy: { order: 'asc' },
        include: {
          chapters: {
            orderBy: { order: 'asc' },
            include: {
              blocks: {
                orderBy: { order: 'asc' },
                include: { choices: true, overrides: true },
              },
            },
          },
        },
      },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hits = runSearch(series, q, bookIds, opts)
  return NextResponse.json({ hits })
}
