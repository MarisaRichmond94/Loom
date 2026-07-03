import { NextResponse } from 'next/server'
import { getLastTouchedChapter, recordLastTouchedChapter } from '@/lib/authorState'

// Last chapter the writer opened in this series. The chapter editor PUTs
// here on mount (fire-and-forget); jump-in surfaces read it to land the
// writer where they left off.

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId } = await params
  return NextResponse.json({ lastTouched: await getLastTouchedChapter(seriesId) })
}

export async function PUT(req: Request, { params }: Params) {
  const { seriesId } = await params
  const { chapterId } = await req.json().catch(() => ({})) as { chapterId?: string }
  if (!chapterId) return NextResponse.json({ error: 'chapterId required' }, { status: 400 })
  await recordLastTouchedChapter(seriesId, chapterId)
  return NextResponse.json({ ok: true })
}
