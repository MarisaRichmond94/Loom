// Persist or delete a WriteAI review session from Loom (KAN-22).
//
// WriteAI stays the single record of review history — Loom does not keep its
// own copy. Both operations proxy so the browser never talks to :8000
// directly.
//
// DANGER, and the reason this route exists rather than a raw fetch from the
// client: WriteAI's PUT does `entries[i] = body`. It REPLACES the whole
// session object, it does not merge. A body missing `messages` silently
// discards the entire conversation, and nothing reports an error. So the
// guard below rejects an incomplete session before it can reach WriteAI.
//
// writer_data/ is backed up nightly and validated as of KAN-27, so a mistake
// here is recoverable — but the guard is what stops it happening.

const base = () => process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:8000'

type Session = {
  id?: string
  label?: string
  book?: string
  chapter?: number
  focus?: string
  draft?: boolean
  timestamp?: string
  messages?: unknown[]
}

/** Every field WriteAI's own review pane writes. Sending fewer silently drops
 *  the rest, so an incomplete session is refused rather than forwarded. */
function missingFields(s: Session): string[] {
  const required: (keyof Session)[] = ['id', 'label', 'book', 'chapter', 'focus', 'messages', 'timestamp']
  return required.filter(k => s[k] === undefined || s[k] === null)
}

export async function PUT(req: Request) {
  let session: Session
  try {
    session = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!session.id) {
    return Response.json({ error: 'session id is required' }, { status: 400 })
  }
  const missing = missingFields(session)
  if (missing.length) {
    return Response.json(
      { error: `refusing to write an incomplete session — WriteAI replaces the whole object, so this would discard: ${missing.join(', ')}` },
      { status: 400 },
    )
  }
  if (!Array.isArray(session.messages) || session.messages.length === 0) {
    return Response.json(
      { error: 'refusing to write a session with no messages — this would erase the conversation' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${base()}/api/sessions/review/${encodeURIComponent(session.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    })
    if (!res.ok) {
      return Response.json({ error: `WriteAI responded ${res.status}` }, { status: 502 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: 'WriteAI is not reachable', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    )
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  try {
    const res = await fetch(`${base()}/api/sessions/review/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      return Response.json({ error: `WriteAI responded ${res.status}` }, { status: 502 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: 'WriteAI is not reachable', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    )
  }
}
