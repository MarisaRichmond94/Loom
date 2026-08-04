import { resolveWriteaiBook } from '@/lib/writeaiBooks'
import { callWriteAi, readJson } from '@/lib/writeaiProxy'
import { isSafeOutlineCardId } from '@/lib/writerOutline'

// Add and remove single outline cards (LOOM-95).
//
// Separate from the whole-list PUT next door, and much safer than it: these two
// endpoints touch one card, so neither can lose a book's planning to a partial
// body. That is why adding and deleting go through here rather than being
// expressed as a PUT of the modified list.

async function bookNumber(req: Request) {
  const url = new URL(req.url)
  const seriesId = url.searchParams.get('seriesId')
  const bookId = url.searchParams.get('bookId')
  if (!seriesId || !bookId) {
    return { response: Response.json({ error: 'seriesId and bookId are required' }, { status: 400 }) }
  }

  const resolved = await resolveWriteaiBook(seriesId, bookId)
  if ('response' in resolved) return resolved
  if ('missing' in resolved) {
    return {
      response: Response.json(
        { error: resolved.missing === 'book' ? 'unknown book' : 'book not ingested by WriteAI' },
        { status: 404 },
      ),
    }
  }
  return { number: resolved.number }
}

/**
 * Append a planned card.
 *
 * `position` is a FLOAT, and that is the whole trick: inserting between two
 * cards means picking a number between theirs, so nothing else has to move and
 * no written chapter is renumbered. WriteAI assigns the id, sets
 * `status: 'planned'` and `chapter: null`, and returns the new card.
 *
 * Only `position` is required. The rest have server-side defaults, and unlike
 * the whole-list PUT an omission here is genuinely "use the default" rather than
 * "erase what was there" — there is nothing there yet.
 */
export async function POST(req: Request) {
  const book = await bookNumber(req)
  if ('response' in book) return book.response

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response
  const body = (parsed.body ?? {}) as Record<string, unknown>

  if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
    return Response.json({ error: 'position must be a finite number' }, { status: 400 })
  }
  const optionalString = (key: string) =>
    body[key] === undefined || typeof body[key] === 'string'
  const badField = ['heading', 'pov', 'writer_summary'].find(k => !optionalString(k))
  if (badField) return Response.json({ error: `${badField} must be a string` }, { status: 400 })

  const result = await callWriteAi(`/api/plan/outline/${book.number}/chapter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position: body.position,
      ...(typeof body.heading === 'string' ? { heading: body.heading } : {}),
      ...(typeof body.pov === 'string' ? { pov: body.pov } : {}),
      ...(typeof body.writer_summary === 'string' ? { writer_summary: body.writer_summary } : {}),
    }),
  })
  if ('response' in result) return result.response
  return Response.json(result.data)
}

/**
 * Remove one card.
 *
 * Deleting a SYNCED card removes the planning card, not the chapter — the
 * manuscript is Loom's and WriteAI's outline store cannot touch it. The UI has
 * to say so, because on screen the card and the chapter look like one object.
 *
 * The id is validated rather than forwarded: it goes straight into a WriteAI
 * path, and an id that is not an id has no business being interpolated into one.
 */
export async function DELETE(req: Request) {
  const book = await bookNumber(req)
  if ('response' in book) return book.response

  const cardId = new URL(req.url).searchParams.get('cardId')
  if (!isSafeOutlineCardId(cardId)) {
    return Response.json({ error: 'a valid cardId is required' }, { status: 400 })
  }

  const result = await callWriteAi(
    `/api/plan/outline/${book.number}/chapter/${encodeURIComponent(cardId)}`,
    { method: 'DELETE' },
  )
  if ('response' in result) return result.response
  return Response.json(result.data ?? { ok: true })
}
