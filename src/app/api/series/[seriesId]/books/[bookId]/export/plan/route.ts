import { NextResponse } from 'next/server'
import { walkBook } from '@/lib/manuscript/walk'
import { loadManuscriptBook, coerceTargetState } from '@/lib/manuscript/loadBook'

// Dry-run of the manuscript export. The modal calls this with the writer's
// target context (and any explicit branch picks) and gets back every choice
// point the walk encountered — which branch was auto-resolved, which need a
// decision — plus warnings (bad endings on the path, loops, …). Re-run on
// every modal change: branch picks shift the story state, which can change
// which chapters and choice points appear downstream.

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const data = await loadManuscriptBook(seriesId, bookId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    targetState?: Record<string, unknown>
    choiceOverrides?: Record<string, string>
  }

  const result = walkBook(
    data.chapters,
    data.variables,
    coerceTargetState(body.targetState, data.variables),
    body.choiceOverrides ?? {},
  )

  return NextResponse.json({
    choicePoints: result.choicePoints,
    warnings: result.warnings,
    chapterCount: result.chapters.length,
  })
}
