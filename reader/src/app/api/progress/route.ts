import { NextResponse } from 'next/server'
import { recordProgress } from '@/lib/progress'
import { resolveReader } from '@/lib/readers'

/**
 * Records where a reader is (LOOM-133).
 *
 * Called on a throttle while reading and once more on the way out, so it is
 * chatty by design and cheap by construction: one upsert into a local SQLite
 * file, no response body worth parsing.
 *
 * THE READER COMES FROM THE COOKIE, never the request body. A body-supplied
 * readerId would let anyone who can reach the host write into someone else's
 * position — which, for a household where the interesting attack is a sibling
 * with a laptop, is exactly the wrong shape.
 */
export async function POST(req: Request) {
  const reader = await resolveReader()
  if (!reader) return new NextResponse(null, { status: 401 })

  const body = await req.json().catch(() => null) as {
    bookId?: string
    chapterId?: string
    offset?: number
  } | null

  if (!body?.bookId || !body?.chapterId) {
    return NextResponse.json({ error: 'bookId and chapterId are required.' }, { status: 400 })
  }

  const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0
  recordProgress(reader.id, body.bookId, body.chapterId, offset)

  // 204: the client has nothing to do with a reply, and this fires often.
  return new NextResponse(null, { status: 204 })
}
