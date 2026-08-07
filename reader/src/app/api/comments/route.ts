import { NextResponse } from 'next/server'
import { commentsFor, postComment, removeOwnComment } from '@/lib/comments'
import { resolveReader } from '@/lib/readers'
import { query } from '@/lib/db'

/**
 * Reader comments (LOOM-134).
 *
 * Every path re-checks the spoiler gate. The page already declines to render a
 * thread the viewer has not earned, but a page is a curtain — this is where the
 * rows actually leave the server, so this is where the rule has to hold.
 *
 * The reader always comes from the cookie. Attribution that could be supplied
 * in a request body is not attribution.
 */

/** The snapshot's publish time, stamped on comments so version drift is visible. */
function publishedAt(): string | null {
  return query<{ value: string }>(
    `SELECT value FROM PublishMeta WHERE key = 'publishedAt'`,
  )[0]?.value ?? null
}

export async function GET(req: Request) {
  const reader = await resolveReader()
  if (!reader) return new NextResponse(null, { status: 401 })

  const url = new URL(req.url)
  const bookId = url.searchParams.get('bookId')
  const chapterId = url.searchParams.get('chapterId')
  if (!bookId || !chapterId) {
    return NextResponse.json({ error: 'bookId and chapterId are required.' }, { status: 400 })
  }

  const comments = commentsFor(reader.id, bookId, chapterId, publishedAt())
  // 403 with no body rather than an empty list: a count is itself a spoiler
  // signal, and "no comments" must not be confused with "not yet".
  if (comments === null) return NextResponse.json({ gated: true }, { status: 403 })

  return NextResponse.json({ comments })
}

export async function POST(req: Request) {
  const reader = await resolveReader()
  if (!reader) return new NextResponse(null, { status: 401 })

  const body = await req.json().catch(() => null) as {
    bookId?: string
    chapterId?: string
    body?: string
  } | null
  if (!body?.bookId || !body?.chapterId) {
    return NextResponse.json({ error: 'bookId and chapterId are required.' }, { status: 400 })
  }

  const result = postComment(
    reader.id, body.bookId, body.chapterId, body.body ?? '', publishedAt(),
  )
  if (!result.ok) {
    return result.reason === 'gated'
      ? NextResponse.json({ error: 'Finish the chapter first.' }, { status: 403 })
      : NextResponse.json({ error: 'Say something first.' }, { status: 400 })
  }

  const comments = commentsFor(reader.id, body.bookId, body.chapterId, publishedAt())
  return NextResponse.json({ comments: comments ?? [] }, { status: 201 })
}

export async function DELETE(req: Request) {
  const reader = await resolveReader()
  if (!reader) return new NextResponse(null, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  // Scoped to the reader's own rows inside the query, so a guessed id belonging
  // to someone else simply matches nothing.
  const removed = removeOwnComment(reader.id, id)
  return removed
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: 'No such comment.' }, { status: 404 })
}
