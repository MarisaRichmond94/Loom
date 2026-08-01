import { writeaiBase } from '@/lib/writeaiProxy'
import { isSafeCharacterId } from '@/lib/writerCharacters'

type Params = { params: Promise<{ id: string }> }

// Upload a character portrait to WriteAI (LOOM-33 / LOOM-43).
//
// Not JSON, so it cannot go through callWriteAi: the body is multipart and is
// forwarded as-is. Reading it into memory and re-encoding would be a second
// place for the boundary to be got wrong.
//
// ⚠️ The id lands in a path that WriteAI interpolates into a GLOB whose
// matches it unlinks. That is guarded there now (LOOM-43), but it is guarded
// here too: a proxy that is only safe because the thing behind it is careful
// is not a guard, and this route is the reason the bug became reachable.

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  if (!isSafeCharacterId(id)) {
    return Response.json({ error: 'invalid character id' }, { status: 400 })
  }

  const contentType = req.headers.get('content-type')
  if (!contentType?.includes('multipart/form-data')) {
    return Response.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${writeaiBase()}/api/plan/characters/${encodeURIComponent(id)}/photo`, {
      method: 'POST',
      // The original boundary header must survive, so it is passed through
      // rather than rebuilt.
      headers: { 'Content-Type': contentType },
      body: req.body,
      // Required by undici to stream a request body rather than buffer it.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
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

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // WriteAI restricts extensions to png/jpg/jpeg/webp/gif; surface its own
    // complaint rather than inventing one.
    return Response.json(
      { error: `WriteAI responded ${res.status}`, upstreamStatus: res.status, detail: data?.detail },
      { status: 502 },
    )
  }
  return Response.json(data)
}
