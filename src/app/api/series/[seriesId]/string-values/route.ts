import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string }> }

// GET /api/series/[seriesId]/string-values
//
// Returns a { variableName: [...distinct string values...] } map gathered
// from every choice's setsVariables payload in the series. Drives the
// condition-row datalist autocomplete so writers can pick exact string
// values they've written elsewhere instead of risking a typo. Number
// and boolean variables don't need this — their inputs constrain the
// shape already.
export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      variables: { where: { type: 'string' }, select: { name: true } },
      books: {
        select: {
          chapters: {
            select: {
              blocks: {
                where: { type: 'choice_point' },
                select: { choices: { select: { setsVariables: true } } },
              },
            },
          },
        },
      },
    },
  })
  if (!series) return NextResponse.json({}, { status: 404 })

  const stringNames = new Set(series.variables.map(v => v.name))
  const buckets: Record<string, Set<string>> = {}

  for (const book of series.books) {
    for (const chapter of book.chapters) {
      for (const block of chapter.blocks) {
        for (const choice of block.choices) {
          let parsed: Record<string, unknown> | null = null
          try { parsed = JSON.parse(choice.setsVariables || '{}') } catch { parsed = null }
          if (!parsed) continue
          for (const [name, raw] of Object.entries(parsed)) {
            if (!stringNames.has(name)) continue
            if (typeof raw !== 'string' || raw === '') continue
            if (!buckets[name]) buckets[name] = new Set()
            buckets[name].add(raw)
          }
        }
      }
    }
  }

  const out: Record<string, string[]> = {}
  for (const [k, set] of Object.entries(buckets)) {
    out[k] = Array.from(set).sort((a, b) => a.localeCompare(b))
  }
  // Autocomplete datalist; recomputing per condition-row open is wasteful.
  // 15s staleness only delays brand-new values appearing in suggestions.
  return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=15' } })
}
