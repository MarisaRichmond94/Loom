import { NextResponse } from 'next/server'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildContentDb } from '@/lib/publish/buildContent'
import { readPublishStatus } from '@/lib/publish/publishStatus'
import {
  CONTENT_DB_PATH,
  LOOM_PUBLIC_ROOT,
  READER_ASSET_ROOT,
  SOURCE_DB_PATH,
} from '@/lib/publish/paths'
import { readProfileSettings } from '@/lib/profileSettings'

// Publishing is DELIBERATELY MANUAL (LOOM-129). Readers should see a coherent
// snapshot the author chose to hand over, not whatever the manuscript happened
// to look like mid-revision. So there is no auto-publish on the `published`
// toggle, and no cron.
//
// Both verbs read dev.db READ-ONLY, through the same pipeline. GET runs it in
// dry-run mode, which is what makes "changed since publish" exact rather than
// a guess from word counts.

type Params = { params: Promise<{ seriesId: string }> }

/** Byline as a reader should see it — the pseudonym wins when enabled. */
async function resolveAuthorName(): Promise<string> {
  const p = await readProfileSettings()
  const pen = (p.pseudonym ?? '').trim()
  return (p.pseudonymEnabled && pen) ? pen : ((p.authorName ?? '').trim() || 'Unknown Author')
}

export async function GET(_req: Request, { params }: Params) {
  const { seriesId } = await params
  try {
    return NextResponse.json(readPublishStatus({
      sourcePath: SOURCE_DB_PATH,
      contentPath: CONTENT_DB_PATH,
      seriesId,
      authorName: await resolveAuthorName(),
    }))
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read publish status' },
      { status: 500 },
    )
  }
}

/**
 * Body: `{ bookIds: [...] }` to publish specific books, or `{}` for all.
 *
 * Per-book is the normal case (LOOM-129): releasing book one while book two is
 * mid-revision is a real workflow. Books not listed keep exactly the rows
 * readers already had — the whole file is still rebuilt and swapped atomically,
 * only each book's SOURCE differs.
 */
export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  try {
    const body = await req.json().catch(() => ({})) as { bookIds?: unknown }
    const bookIds = Array.isArray(body.bookIds)
      ? body.bookIds.filter((x): x is string => typeof x === 'string')
      : undefined
    if (bookIds && bookIds.length === 0) {
      return NextResponse.json({ error: 'No books selected to publish.' }, { status: 400 })
    }

    mkdirSync(path.dirname(CONTENT_DB_PATH), { recursive: true })
    mkdirSync(READER_ASSET_ROOT, { recursive: true })

    const result = buildContentDb({
      sourcePath: SOURCE_DB_PATH,
      outPath: CONTENT_DB_PATH,
      seriesId,
      authorName: await resolveAuthorName(),
      publishedAt: new Date().toISOString(),
      bookIds,
      publicRoot: LOOM_PUBLIC_ROOT,
      readerAssetRoot: READER_ASSET_ROOT,
    })
    return NextResponse.json(result)
  } catch (e) {
    // Publishing refusing is a first-class outcome, not a crash: an overlapping
    // asset root, a missing series, a locked database. Say which, so the button
    // never appears to have silently done nothing.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Publish failed' },
      { status: 500 },
    )
  }
}
