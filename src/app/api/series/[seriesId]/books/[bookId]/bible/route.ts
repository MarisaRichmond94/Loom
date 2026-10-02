import { NextResponse } from 'next/server'
import { resolveWriteaiBook } from '@/lib/writeaiBooks'
import { writeaiBase, UNREACHABLE } from '@/lib/writeaiProxy'

// The book's story bible, as a markdown download (LOOM-157).
//
// WriteAI assembles this from its extraction + enrichment layers
// (`GET /api/books/{n}/bible` — deterministic, no LLM call, no cost). Until now
// the only way to get one was WriteAI's own status pane, which is the last
// thing left sending the writer over there for something Loom can hand her.
//
// Proxied as a stream rather than through `callWriteAi`: that helper parses
// JSON, and this is a text/markdown body with a Content-Disposition that names
// the file. Upstream's filename is kept — it already encodes the book number
// and slug, and renaming it here would make two apps disagree about what the
// same export is called.

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  const resolved = await resolveWriteaiBook(seriesId, bookId)
  if ('response' in resolved) return resolved.response
  if ('missing' in resolved) {
    return resolved.missing === 'book'
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : NextResponse.json(
          { error: 'WriteAI has not ingested this book, so it has no story bible yet.' },
          { status: 404 },
        )
  }

  let res: Response
  try {
    res = await fetch(`${writeaiBase()}/api/books/${resolved.number}/bible`, { cache: 'no-store' })
  } catch (err) {
    return NextResponse.json(
      {
        error: 'WriteAI is not reachable',
        unreachable: true,
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: UNREACHABLE },
    )
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: `WriteAI responded ${res.status}`, upstreamStatus: res.status },
      { status: 502 },
    )
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'text/markdown; charset=utf-8',
      'Content-Disposition':
        res.headers.get('Content-Disposition') ?? 'attachment; filename="story-bible.md"',
      'Cache-Control': 'no-store',
    },
  })
}
