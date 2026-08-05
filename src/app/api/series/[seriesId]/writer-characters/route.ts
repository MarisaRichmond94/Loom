import { NextResponse } from 'next/server'
import { resolveWriterCharactersForSeries } from '@/lib/writerCharacterSeries'

// The whole cast of a series — LOOM-104, under LOOM-5.
//
// The series-scope sibling of
// /api/series/[seriesId]/books/[bookId]/writer-characters. Read-only, and it
// reads Loom's snapshot rather than WriteAI directly: this runs on every render
// of the series page's Characters tab, and `GET /api/plan/characters` writes to
// disk.
//
// Deduplicated: a character in four books comes back once, carrying the books
// they are tagged in rather than one row per book.
export async function GET(_: Request, { params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params
  const result = await resolveWriterCharactersForSeries(seriesId)
  if ('error' in result) return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  return NextResponse.json(result.characters)
}
