import { callWriteAi, readJson } from '@/lib/writeaiProxy'

// Add a location to WriteAI's writer-event location pool (LOOM-32 / LOOM-35).
//
// The pool is returned alongside the event list by GET /api/writeai/events, so
// there is no GET here — only the write. WriteAI folds names in case-preserving
// and de-duplicated (_add_location), so posting an existing name is a harmless
// no-op rather than a duplicate.
//
// Static segment, so this wins over events/[id] — "locations" never arrives
// there as an event id.

export async function POST(req: Request) {
  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  const name = (parsed.body as { name?: unknown } | null)?.name
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
  }

  const result = await callWriteAi('/api/writer-events/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  })
  if ('response' in result) return result.response
  return Response.json(result.data)
}
