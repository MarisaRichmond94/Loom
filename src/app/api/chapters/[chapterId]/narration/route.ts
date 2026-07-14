import { NextResponse } from 'next/server'
import { ensureFresh, getStatus } from '@/lib/narration/generate'

type Params = { params: Promise<{ chapterId: string }> }

// Poll endpoint for the reader. Reports whether fresh narration exists without
// triggering any work: 'ready' (with audio path + word timings), 'generating',
// 'stale', 'none', or 'empty'.
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  return NextResponse.json(await getStatus(chapterId))
}

// Trigger endpoint, fired when the reader opens a chapter (i.e. the Preview
// button's destination). Regenerates if the chapter's text changed, but returns
// immediately — synthesis runs in the background and the reader polls GET.
export async function POST(_: Request, { params }: Params) {
  const { chapterId } = await params
  return NextResponse.json(await ensureFresh(chapterId))
}
