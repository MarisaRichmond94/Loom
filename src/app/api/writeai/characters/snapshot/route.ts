import { NextResponse } from 'next/server'
import { readSnapshot, refreshWriterCharacterSnapshot } from '@/lib/writerCharacterSnapshot'

// Loom's local copy of WriteAI's writer-character pool (LOOM-86, under
// LOOM-5).
//
//   GET  — read the snapshot. Never touches WriteAI. Safe on any path,
//          including reader and preview pages, at any frequency.
//   POST — refresh it from WriteAI, then return the new contents.
//
// ⚠️ The split is the whole point. `GET /api/plan/characters` — what POST
// calls — WRITES TO DISK on WriteAI's side: it seeds from canon, prunes
// entries canon reclassifies, and rewrites `books` from numbers to names,
// saving whenever any of that changes. So refreshing is a deliberate,
// user-initiated act (tab open, after a character write, explicit refresh
// control) and never something a render does.
//
// If you find yourself wanting to POST on an interval, on a retry, or "just to
// be safe" in a useEffect: don't. Rendering a cast list must not mutate
// another application's data file.

export async function GET() {
  return NextResponse.json(await readSnapshot())
}

export async function POST() {
  const result = await refreshWriterCharacterSnapshot()
  if (!result.ok) {
    // The previous snapshot is still intact — refresh failing is not the same
    // as having no characters, and the UI must be able to tell those apart.
    return NextResponse.json(
      { error: result.error, unreachable: result.unreachable, characters: await readSnapshot() },
      { status: result.unreachable ? 503 : 502 },
    )
  }
  return NextResponse.json({
    upserted: result.upserted,
    deleted: result.deleted,
    characters: await readSnapshot(),
  })
}
