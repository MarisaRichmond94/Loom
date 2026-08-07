import { NextResponse } from 'next/server'
import { findMissingCanonNarration } from '@/lib/narration/canonBackfill'
import { ensureFresh } from '@/lib/narration/generate'

/**
 * Backfill canon narration (LOOM-136).
 *
 *   GET  — which canon chapters have no recording publish would ship.
 *   POST — generate the next one, and WAIT for it.
 *
 * One chapter per POST, deliberately. Synthesis is minutes of CPU per chapter
 * and there are potentially a hundred of them; a single request that did the
 * lot would sit open for hours, and any interruption would lose the lot with
 * it. One-at-a-time makes the sweep resumable, gives honest progress, and lets
 * the author stop whenever they like — the work already done is on disk.
 */

export async function GET(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })

  const missing = await findMissingCanonNarration(seriesId, url.searchParams.get('bookId') ?? undefined)
  return NextResponse.json({
    remaining: missing.length,
    chapters: missing.map(m => ({ book: m.bookTitle, label: m.label, chapterId: m.chapterId })),
  })
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })

  const missing = await findMissingCanonNarration(seriesId, url.searchParams.get('bookId') ?? undefined)
  if (missing.length === 0) return NextResponse.json({ done: true, remaining: 0 })

  const next = missing[0]

  // Generated against the CANON state and answers, so the variant that appears
  // is the one publish looks for. ensureFresh returns as soon as it has kicked
  // work off, so poll it — with trigger=false, so a poll only observes.
  await ensureFresh(next.chapterId, next.state, next.answered)

  const startedAt = Date.now()
  const LIMIT_MS = 15 * 60 * 1000
  for (;;) {
    const status = await ensureFresh(next.chapterId, next.state, next.answered, undefined, false)
    if (status.status === 'ready') break
    if (status.status === 'error') {
      return NextResponse.json(
        { done: false, failed: true, chapter: `${next.bookTitle} ${next.label}`, remaining: missing.length },
        { status: 500 },
      )
    }
    // A chapter that never finishes must not hold the sweep open forever.
    if (Date.now() - startedAt > LIMIT_MS) {
      return NextResponse.json(
        { done: false, timedOut: true, chapter: `${next.bookTitle} ${next.label}`, remaining: missing.length },
        { status: 504 },
      )
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  return NextResponse.json({
    done: false,
    chapter: `${next.bookTitle} ${next.label}`,
    remaining: missing.length - 1,
  })
}
