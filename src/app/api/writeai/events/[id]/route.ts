import { callWriteAi, readJson } from '@/lib/writeaiProxy'
import { validateWriterEvent } from '@/lib/writerEvents'
import { parseWriterEventId } from '@/lib/chapterEvents'

type Params = { params: Promise<{ id: string }> }

// Update or delete one WriteAI writer-event (LOOM-32 / LOOM-35).
//
// Note the sibling route at events/locations: Next.js matches static segments
// before dynamic ones, so POST /api/writeai/events/locations reaches that file
// and never arrives here as id="locations".

/**
 * ⚠️ PATCH REPLACES THE WHOLE EVENT.
 *
 * WriteAI's WriterEventBody defaults every field, so a body missing `characters`
 * does not leave them alone — it empties them, silently, with a 200. That is why
 * this route validates rather than forwarding: the failure is invisible from the
 * response, and the data it eats is hand-authored.
 *
 * The client must therefore send the COMPLETE event, not a diff. Loom's modal
 * loads the full event and submits all of it.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const validId = parseWriterEventId({ writerEventId: id })
  if ('error' in validId) return Response.json({ error: validId.error }, { status: 400 })

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  const validated = validateWriterEvent(parsed.body)
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 })

  const result = await callWriteAi(`/api/writer-events/${encodeURIComponent(validId.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated.event),
  })
  if ('response' in result) return result.response
  return Response.json(result.data)
}

/**
 * Delete an event in WriteAI — everywhere, for good.
 *
 * Loom's own ChapterEvent rows pointing at it are deliberately NOT cleaned up
 * here. They become unresolvable ids, which the degradation contract already
 * covers: hidden from the UI, never auto-deleted. Cascading a WriteAI deletion
 * into Loom's database would make a remote failure destroy local rows, and the
 * rows cost nothing to leave.
 */
export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params
  const validId = parseWriterEventId({ writerEventId: id })
  if ('error' in validId) return Response.json({ error: validId.error }, { status: 400 })

  const result = await callWriteAi(`/api/writer-events/${encodeURIComponent(validId.id)}`, {
    method: 'DELETE',
  })
  if ('response' in result) return result.response
  return Response.json({ ok: true })
}
