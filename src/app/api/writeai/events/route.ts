import { callWriteAi, readJson } from '@/lib/writeaiProxy'
import { validateWriterEvent } from '@/lib/writerEvents'

// WriteAI writer-events, proxied (LOOM-32 / LOOM-35).
//
// Loom NEVER writes writer_events.json directly, even though it now offers full
// CRUD over it. Every mutation goes through WriteAI's HTTP API so the FastAPI
// process stays the file's single writer — writer_store rewrites the whole file
// on each save under an in-process lock, which a second process would defeat.

/**
 * The full event list plus the location pool.
 *
 * Passed through unfiltered: writer_events.json is small (144 events), unlike
 * sessions.json, so the Events tab filters client-side. Unlike WriteAI's
 * characters endpoint, this one is a genuine read with no side effects — it
 * neither seeds nor prunes nor rewrites — so it is safe to call on tab open.
 */
export async function GET() {
  const result = await callWriteAi('/api/writer-events')
  if ('response' in result) return result.response
  return Response.json(result.data)
}

/**
 * Create an event.
 *
 * Body is validated in full even though creating with a partial body is not
 * destructive — see validateWriterEvent for why the contract is uniform.
 */
export async function POST(req: Request) {
  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  const validated = validateWriterEvent(parsed.body)
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 })

  const result = await callWriteAi('/api/writer-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated.event),
  })
  if ('response' in result) return result.response
  return Response.json(result.data)
}
