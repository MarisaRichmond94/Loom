import { callWriteAi, readJson } from '@/lib/writeaiProxy'
import { isSafeCharacterId, validateWriterCharacter } from '@/lib/writerCharacters'

type Params = { params: Promise<{ id: string }> }

// Update or delete one WriteAI writer-character (LOOM-33 / LOOM-43).
//
// Loom never writes writer_characters.json directly; every mutation goes
// through WriteAI's HTTP API so the FastAPI process stays the file's single
// writer.

/**
 * ⚠️ WriteAI STORES THE BODY VERBATIM.
 *
 * `PUT /api/plan/characters/{char_id}` has no Pydantic model — it does
 * `chars[i] = body`. A key you omit is not reset to a default, it is DELETED.
 * Renaming a character with a partial body would drop their traits,
 * relationships and books, return 200, and look fine until someone opened the
 * Plan page weeks later.
 *
 * The route is also an UPSERT: an unknown id appends rather than 404ing, which
 * is how WriteAI's own UI creates characters. Loom uses it the same way, so a
 * client-minted id must be safe to put in a path.
 */
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params
  if (!isSafeCharacterId(id)) {
    return Response.json({ error: 'invalid character id' }, { status: 400 })
  }

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  const validated = validateWriterCharacter(parsed.body)
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 })

  // The id in the path wins — WriteAI sets body["id"] = char_id anyway, and
  // letting the two disagree would be a silent way to overwrite the wrong
  // character.
  if (validated.character.id !== id) {
    return Response.json({ error: 'id in body does not match the URL' }, { status: 400 })
  }

  const result = await callWriteAi(`/api/plan/characters/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated.character),
  })
  if ('response' in result) return result.response
  return Response.json(result.data)
}

/**
 * Delete a character in WriteAI — everywhere, for good.
 *
 * Loom's own ChapterCharacter rows pointing at it are deliberately NOT cleaned
 * up here. They become unresolvable ids, which the degradation contract
 * already covers: hidden from the UI, never auto-deleted. Cascading a remote
 * deletion into Loom's database would let a WriteAI failure destroy local
 * rows, and the rows cost nothing to leave.
 */
export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params
  if (!isSafeCharacterId(id)) {
    return Response.json({ error: 'invalid character id' }, { status: 400 })
  }

  const result = await callWriteAi(`/api/plan/characters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if ('response' in result) return result.response
  return Response.json({ ok: true })
}
