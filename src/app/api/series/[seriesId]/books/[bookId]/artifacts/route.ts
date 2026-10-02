import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { statusForBook } from '@/lib/manuscript/canonStatus'
import {
  artifactRuns,
  scriptBookIndex,
  startArtifactRun,
  type ArtifactKind,
} from '@/lib/writingArtifacts'

// Start / observe an on-demand audiobook or EPUB build for one book (LOOM-157).
//
// Both artifacts are rebuilt nightly for backup purposes. This is the "do it
// now" path: the writer has just finished a pass and wants the .m4b or .epub on
// her phone without waiting for 22:30, or last night's run failed.
//
// The work is a shell script that runs for minutes, so POST starts it and
// returns immediately with the run's state; the menu polls GET. See
// lib/writingArtifacts.ts for why the run lives in process memory and why the
// book is addressed by parsing the script's own registry.

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

const KINDS: ArtifactKind[] = ['audiobook', 'epub']

const isKind = (v: unknown): v is ArtifactKind =>
  typeof v === 'string' && (KINDS as string[]).includes(v)

/**
 * The series check is not ceremony — without it any book id in the database
 * resolves through any series in the URL. Same rule as the WriteAI proxies.
 */
async function ownedBook(seriesId: string, bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, title: true, seriesId: true, order: true, canon: true },
  })
  return book && book.seriesId === seriesId ? book : null
}

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const book = await ownedBook(seriesId, bookId)
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Which kinds this book can even be built as, so the menu disables with a
  // reason rather than offering a button that 409s. A branch book, or one
  // added since the scripts were last edited, has no entry in their registry.
  const available: Partial<Record<ArtifactKind, boolean>> = {}
  for (const kind of KINDS) {
    available[kind] = (await scriptBookIndex(kind, book.title)) !== null
  }

  // Both builders read the .pages manuscript on disk, NOT dev.db. So the
  // honest answer to "regenerate the audiobook" depends on something the
  // button itself cannot see: whether that file is this book as it stands.
  // Canon auto-export usually keeps it current, but when it has not run the
  // writer would otherwise re-narrate last week's prose and be told it
  // succeeded — which it would have, at the wrong job.
  //
  // Reported, never enforced. A stale manuscript is a reason to warn, not a
  // reason to refuse: rebuilding from a known-older manuscript is a legitimate
  // thing to want, and the menu says which it is.
  //
  // Skipped for an alt book, which has no folder under the canon root and
  // never will (LOOM-149) — it would report `no-folder` forever, which is the
  // book behaving correctly, not a warning. Those books have no script entry
  // either, so `available` is already false for both kinds.
  let manuscript: { current: boolean; reason: string; detail?: string } | null = null
  try {
    if (!book.canon) throw new Error('alt book — not canon-exported')
    const status = await statusForBook(book)
    manuscript = { current: status.current, reason: status.reason, detail: status.detail }
  } catch {
    // A currency check that cannot run is a missing warning, never an error on
    // a menu that is mostly about other things.
  }

  return NextResponse.json({ runs: artifactRuns(bookId), available, manuscript })
}

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const book = await ownedBook(seriesId, bookId)
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let kind: unknown
  try {
    kind = (await req.json())?.kind
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!isKind(kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
  }

  const result = await startArtifactRun(kind, book)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  // 202: accepted and running, not finished. The body is the run, so the menu
  // can show "Generating…" without waiting a poll interval to find out.
  return NextResponse.json({ run: result.run }, { status: 202 })
}
