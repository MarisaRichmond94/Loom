import { NextResponse } from 'next/server'
import { commentsForChapter } from '@/lib/readerComments'

/**
 * The author's read of reader comments (LOOM-135).
 *
 * Read-only. The two write actions live at `[id]` so that the mutating surface
 * is one small, findable file rather than a verb buried in this one.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const bookId = url.searchParams.get('bookId')
  const chapterId = url.searchParams.get('chapterId')
  if (!bookId || !chapterId) {
    return NextResponse.json({ error: 'bookId and chapterId are required.' }, { status: 400 })
  }
  return NextResponse.json(commentsForChapter(bookId, chapterId))
}
