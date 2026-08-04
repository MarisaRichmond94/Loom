import { NextResponse } from 'next/server'
import { resolveWriterCharactersForBook } from '@/lib/writerCharacterBook'

type Params = { params: Promise<{ bookId: string }> }

// The cast of one book — LOOM-88, under LOOM-5. Successor to
// /api/series/[seriesId]/books/[bookId]/characters.
//
// WriteAI's records joined to Loom's per-book overlay. Read-only, and it reads
// Loom's snapshot rather than WriteAI directly: this runs on every render of
// the book page and the reader's book landing, and `GET /api/plan/characters`
// writes to disk.
//
// Characters hidden by a later first appearance come back with `visible:
// false` rather than being dropped — the author's grid shows them so they can
// be un-hidden, the reader's page filters them out.
export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  const result = await resolveWriterCharactersForBook(bookId)
  if ('error' in result) return NextResponse.json({ error: 'Book not found' }, { status: 404 })
  return NextResponse.json(result.characters)
}
