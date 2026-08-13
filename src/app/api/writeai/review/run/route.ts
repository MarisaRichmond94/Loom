import { prisma } from '@/lib/prisma'
import { reviewNumberForChapter } from '@/lib/crossAppJump'

// Run a WriteAI review from inside Loom, streaming the result back (KAN-22).
//
// A PROXY, deliberately. WriteAI makes the Anthropic call and books the cost
// under surface="review" exactly as it does for its own pane — Loom has no
// ANTHROPIC_API_KEY and cannot call the model even by accident. WriteAI is the
// LLM service; Loom is the writing app, and that boundary is enforced by key
// ownership rather than convention.
//
// Proxying rather than letting the browser hit :8000 also keeps it same-origin
// (no CORS) and keeps WriteAI's URL server-side.
//
// `chapter_text` is what removes the resync: WriteAI documents it as winning
// over the index, so the reviewer reads the writer's LIVE editor content with
// no export, no ingest, and nothing written to disk.

export const dynamic = 'force-dynamic'

type Body = {
  seriesId: string
  bookId: string
  chapterId: string
  chapterText: string
  focus?: string
  message?: string
  previousText?: string
  conversationHistory?: unknown[]
  includeIdeal?: boolean
  model?: string | null
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { seriesId, bookId, chapterId, chapterText } = body
  if (!seriesId || !bookId || !chapterId) {
    return Response.json({ error: 'seriesId, bookId and chapterId are required' }, { status: 400 })
  }
  // Reviewing empty text would spend money to be told the chapter is empty.
  if (!chapterText || !chapterText.trim()) {
    return Response.json({ error: 'chapter has no text to review' }, { status: 400 })
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { title: true, seriesId: true },
  })
  if (!book || book.seriesId !== seriesId) {
    return Response.json({ error: 'unknown book' }, { status: 404 })
  }

  // Same read-only canon-walk address the lookup uses. Passing the number
  // matters: WriteAI treats a draft with chapter=null as following everything
  // synced for the book, which would place this chapter at the wrong point in
  // its story-so-far digest.
  const chapter = await reviewNumberForChapter(seriesId, bookId, chapterId)

  const base = process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:8000'
  let upstream: Response
  try {
    upstream = await fetch(`${base}/api/review/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book: book.title,
        chapter,
        chapter_text: chapterText,
        previous_text: body.previousText ?? null,
        focus: body.focus ?? 'Literary Agent',
        message: body.message ?? '',
        conversation_history: body.conversationHistory ?? [],
        include_ideal: body.includeIdeal ?? false,
        model: body.model ?? null,
      }),
    })
  } catch (err) {
    return Response.json(
      { error: 'WriteAI is not reachable', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    )
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    return Response.json(
      { error: `WriteAI responded ${upstream.status}`, detail: detail.slice(0, 500) },
      { status: 502 },
    )
  }

  // Pass the SSE straight through. No buffering — the point of streaming is
  // that the writer reads the review as it arrives.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
