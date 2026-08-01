// Shared plumbing for Loom's server-side WriteAI proxies (LOOM-32).
//
// Every WriteAI call from Loom goes through a route handler rather than the
// browser: same-origin (no CORS), the WriteAI base URL never reaches client
// code, and — the point that matters for the writer-event seam — Loom can
// refuse a malformed write before it reaches an endpoint that replaces whole
// objects.
//
// The status codes are a contract the UI depends on, so they live here rather
// than being retyped per route:
//
//   503 — WriteAI is not running. The tab must say so explicitly; an empty
//         list would read as "no events", which is a lie.
//   502 — WriteAI answered, but with an error. Its status is passed through in
//         the message so a 404 stays distinguishable from a 500.
//
// Mirrors the shape already established in api/writeai/review/session/route.ts.

export const writeaiBase = () => process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:8000'

export const UNREACHABLE = 503

/**
 * Call WriteAI and normalise both failure modes.
 *
 * Returns the parsed JSON on success, or a Response to return as-is. Callers
 * that need the raw body (streaming, images) should not use this.
 */
export async function callWriteAi(
  path: string,
  init?: RequestInit,
): Promise<{ data: unknown } | { response: Response }> {
  let res: Response
  try {
    res = await fetch(`${writeaiBase()}${path}`, init)
  } catch (err) {
    return {
      response: Response.json(
        {
          error: 'WriteAI is not reachable',
          unreachable: true,
          detail: err instanceof Error ? err.message : 'unknown',
        },
        { status: UNREACHABLE },
      ),
    }
  }

  if (!res.ok) {
    // Surface WriteAI's own status rather than flattening everything to 502 —
    // a 404 on an event someone else deleted is not the same problem as a 500.
    let detail: string | undefined
    try {
      detail = (await res.json())?.detail
    } catch {
      /* non-JSON error body — the status is all we have */
    }
    return {
      response: Response.json(
        { error: `WriteAI responded ${res.status}`, upstreamStatus: res.status, detail },
        { status: 502 },
      ),
    }
  }

  // 204/205 carry no body; DELETE endpoints legitimately use them.
  if (res.status === 204 || res.status === 205) return { data: null }
  try {
    return { data: await res.json() }
  } catch {
    return { data: null }
  }
}

/** Read and parse a JSON request body, or the 400 to return. */
export async function readJson(req: Request): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await req.json() }
  } catch {
    return { response: Response.json({ error: 'invalid JSON body' }, { status: 400 }) }
  }
}
