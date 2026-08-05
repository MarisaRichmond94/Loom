import { selectChatSessions, validateChatSession } from '@/lib/exploreSessions'
import { callWriteAi, readJson, writeaiBase } from '@/lib/writeaiProxy'

// Explore chat history, shared with WriteAI (LOOM-116).
//
// WriteAI stays the single record of chat history — Loom keeps no copy. The
// same threads appear in both apps, which is the point, and is also why the
// scope chip in the drawer matters: a thread asked on the book-3 page and one
// asked in WriteAI over five books are different questions, and reopening the
// wrong one silently changes what the model can see.
//
// GET  — the thread LIST, filtered and reduced server-side.
// GET ?id=  — one thread's full conversation, fetched only when opened.
// PUT  — upsert, guarded (see below).
// DELETE — remove.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')

  const result = await callWriteAi('/api/sessions', { cache: 'no-store' })
  if ('response' in result) return result.response

  if (id) {
    const chat = (result.data as { chat?: unknown[] })?.chat ?? []
    const found = (chat as Record<string, unknown>[]).find(s => s?.id === id)
    if (!found) return Response.json({ error: 'unknown session' }, { status: 404 })
    return Response.json({ session: found })
  }

  // `GET /api/sessions` returns the WHOLE file — ~800 KB, chat and review both.
  // Reduced here so the browser never receives review sessions it cannot show,
  // or the conversation bodies of threads nobody has opened.
  return Response.json({ sessions: selectChatSessions(result.data) })
}

export async function PUT(req: Request) {
  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  // ⚠️ The guard that matters. WriteAI's PUT replaces the whole session
  // object, so an incomplete body silently destroys the conversation. Refuse
  // it here rather than discovering it later in a thread that is simply gone.
  const check = validateChatSession(parsed.body)
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 })

  const id = check.session.id as string
  try {
    const res = await fetch(
      `${writeaiBase()}/api/sessions/chat/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(check.session),
      },
    )
    if (!res.ok) {
      return Response.json({ error: `WriteAI responded ${res.status}` }, { status: 502 })
    }
    return Response.json({ ok: true })
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
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  const result = await callWriteAi(
    `/api/sessions/chat/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  if ('response' in result) return result.response
  return Response.json({ ok: true })
}
