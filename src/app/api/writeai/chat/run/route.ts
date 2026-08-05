import { clampBookSelection, clampPovSelection } from '@/lib/exploreScope'
import { resolveExploreScope } from '@/lib/exploreScopeServer'
import { writeaiBase } from '@/lib/writeaiProxy'

// Run an Explore chat from inside Loom, streaming the answer back (LOOM-112).
//
// A PROXY, deliberately — the same shape as `review/run/route.ts`, and for the
// same reasons. WriteAI makes the Anthropic call and books the cost under
// `surface="chat"`; `ANTHROPIC_API_KEY` exists only in WriteAI's `.env`, so
// Loom cannot spend money here even by accident. That boundary is enforced by
// key ownership rather than by convention, and it should stay that way.
//
// Proxying also keeps it same-origin (no CORS) and keeps WriteAI's URL out of
// client code.
//
// ── What this route adds over a dumb pipe ───────────────────────────────────
//
// It CLAMPS the book selection to what the page is allowed to search. On a
// book page that is this book and every book before it. The dropdown enforces
// the same rule, but a dropdown is a suggestion — this is the enforcement, and
// a hand-edited request naming a later book simply has it dropped.
//
// Note the ordering: the clamp needs the scope, and the scope needs a call to
// WriteAI. That call happens BEFORE the stream opens, which is what lets a
// 503/502 still be a status code. Once bytes are flowing there is nowhere left
// to put one.

export const dynamic = 'force-dynamic'

type Body = {
  seriesId?: string
  bookId?: string | null
  message?: string
  mode?: string
  /** Loom book cuids. Empty/absent means "everything this page allows". */
  bookIds?: unknown
  povs?: unknown
  conversationHistory?: unknown[]
  model?: string | null
  thorough?: boolean
}

/** WriteAI's `mode` values. Anything else is a client bug, not a new feature. */
const MODES = new Set(['general', 'plot_hole', 'timeline', 'character', 'alternate'])

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { seriesId, bookId } = body
  if (!seriesId) {
    return Response.json({ error: 'seriesId is required' }, { status: 400 })
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    // Asking nothing would spend money to be told nothing was asked.
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const scope = await resolveExploreScope(seriesId, bookId)
  if ('response' in scope) return scope.response
  if ('missing' in scope) {
    return Response.json(
      {
        error: scope.missing === 'book'
          ? 'unknown book'
          : 'WriteAI has not analysed this series yet',
        status: scope.missing === 'book' ? 'unknown-book' : 'not-analyzed',
      },
      { status: scope.missing === 'book' ? 404 : 409 },
    )
  }

  const books = clampBookSelection(scope, body.bookIds)
  const povs = clampPovSelection(scope, body.povs)
  const mode = typeof body.mode === 'string' && MODES.has(body.mode)
    ? body.mode
    : 'general'

  // The last few turns only. WriteAI slices to 8 server-side anyway; sending
  // the whole thread would just grow the request for no effect.
  const history = Array.isArray(body.conversationHistory)
    ? body.conversationHistory
        .filter((m): m is { role: string; content: string } =>
          !!m && typeof m === 'object'
          && typeof (m as { role?: unknown }).role === 'string'
          && typeof (m as { content?: unknown }).content === 'string')
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))
    : []

  let upstream: Response
  try {
    upstream = await fetch(`${writeaiBase()}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        mode,
        // WriteAI's `resolve_books` accepts numbers or titles; numbers, because
        // they are what its own index is keyed by and cannot be tripped by a
        // curly apostrophe on the way back across.
        book_filter: books,
        pov_filter: povs,
        conversation_history: history,
        model: body.model ?? null,
        thorough: body.thorough === true,
      }),
    })
  } catch (err) {
    return Response.json(
      {
        error: 'WriteAI is not reachable',
        unreachable: true,
        detail: err instanceof Error ? err.message : 'unknown',
      },
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
  // that the writer reads the answer as it arrives.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
