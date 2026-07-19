import { NextResponse } from 'next/server'
import { ensureFresh, getStatus } from '@/lib/narration/generate'
import type { StoryState } from '@/lib/storyEngine'

type Params = { params: Promise<{ chapterId: string }> }

type Body = {
  // The reader's current variable state and the choices they've answered
  // (choicePointId -> chosen choiceId), so narration covers exactly the prose
  // they've unlocked, resolved against the branch they took.
  storyState?: StoryState
  answered?: Record<string, string>
  // True for the reader's initial request for a chapter/unlock state (may start
  // generation); false for the subsequent polls (observe only).
  trigger?: boolean
}

// Read-only status against the default (pre-choice) variant — never triggers
// work. The reader drives generation via POST with its own state.
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  return NextResponse.json(await getStatus(chapterId))
}

// Trigger + poll endpoint for the reader. Given the reader's state + answered
// choices, ensures narration exists for the prose they've unlocked, returning
// immediately with a status while synthesis runs in the background.
export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params
  const body = (await req.json().catch(() => ({}))) as Body
  return NextResponse.json(
    await ensureFresh(chapterId, body.storyState, body.answered, undefined, body.trigger ?? false),
  )
}
