import { resolveWriteaiBook } from '@/lib/writeaiBooks'
import { callWriteAi, readJson } from '@/lib/writeaiProxy'
import { validateOutlineCards } from '@/lib/writerOutline'

// The book's plan outline, proxied read and write (LOOM-95).
//
// WriteAI's plan pane and Loom's book page are now two editors over one
// `plan_outline.json`. That is workable because the store is keyed by Loom's
// book cuid (KAN-24) — both apps genuinely agree which outline belongs to which
// book, rather than agreeing by position and drifting the first time a book is
// inserted.
//
// ⚠️ ACCEPTED RISK: LAST WRITE WINS.
//
// There is no locking on the store and no conditional-write support upstream.
// With the outline open in both apps, whichever saves second silently
// overwrites the other's cards — no conflict, no error, no symptom until you
// notice planning missing later. This was accepted deliberately rather than
// mitigated (the guard would be a version the seam refuses to overwrite, which
// is not worth the work for one writer). Recorded here so a future "my cards
// disappeared" is recognised as this and not chased as a bug. The operational
// rule is simply: do not plan in both windows at once.
//
// ⚠️ GET IS NOT A PURE READ. See the note on GET below.

/** Both handlers take the book the same way. */
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
      response:
        resolved.missing === 'book'
          ? Response.json({ error: 'unknown book' }, { status: 404 })
          : // Distinct from "no outline": WriteAI cannot hold an outline for a
            // book it has never ingested, and the section says so rather than
            // showing an empty planning board for a book full of chapters.
            Response.json({ outline: null, reason: 'book-not-in-writeai' }),
    }
  }
  return { number: resolved.number }
}

/**
 * The book's cards, plus its sync state.
 *
 * ⚠️ NOT a pure read, unlike the insights endpoint. WriteAI seeds a missing
 * outline from canon, runs `_auto_reconcile`, and SAVES — all on an ordinary
 * GET. So: fetch on section open and after mutations, never on a timer, and
 * never speculatively for a book nobody is looking at. Opening this section for
 * the first time legitimately writes to WriteAI's store, which is worth knowing
 * before you read file mtimes while debugging something else.
 */
export async function GET(req: Request) {
  const book = await bookNumber(req)
  if ('response' in book) return book.response

  const result = await callWriteAi(`/api/plan/outline/${book.number}`, { cache: 'no-store' })
  if ('response' in result) return result.response
  return Response.json({ outline: result.data })
}

/**
 * Replace the book's whole chapter list.
 *
 * The only write WriteAI offers for card CONTENT — there is no per-card update —
 * so every edit, reorder and field change comes through here as the complete
 * list. `validateOutlineCards` refuses anything incomplete first: a card that
 * arrives without `extracted_bullets` does not keep them, it loses them, with a
 * 200 and nothing in the response to say so.
 *
 * The client must send back what it loaded. A stale list in memory writes stale
 * cards over fresh ones, and this route cannot tell the difference — see the
 * accepted-risk note above.
 */
export async function PUT(req: Request) {
  const book = await bookNumber(req)
  if ('response' in book) return book.response

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response

  const url = new URL(req.url)
  const validated = validateOutlineCards(parsed.body, {
    allowEmpty: url.searchParams.get('allowEmpty') === '1',
  })
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 })

  const result = await callWriteAi(`/api/plan/outline/${book.number}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapters: validated.cards }),
  })
  if ('response' in result) return result.response

  // WriteAI's PUT returns get_outline(), which re-runs auto-reconcile — the
  // list coming back can legitimately differ from the one sent. Returned as-is
  // so the client can trust the response over its local state.
  return Response.json({ outline: result.data })
}
