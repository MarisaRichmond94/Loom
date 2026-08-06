import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

// The writer's summary for a chapter WriteAI cannot describe (LOOM-120).
//
// Sibling of ../notes, and the same upsert shape — but a different field for a
// different job. Notes are the private scratchpad; this is the description that
// renders on the Chapters tab's card, where a branch chapter would otherwise
// show nothing at all because no outline card exists for it and none can.
//
// The ONLY write in the Chapters tab. Everything else there is a read: the
// sequence comes from Loom, the summaries for canon chapters are joined from
// WriteAI's outline read-only, and neither is touched here. This endpoint
// writes one row in one Loom-owned table and cannot reach the manuscript, the
// canon export, or WriteAI.

/** Generous, but not unbounded — a card summary that runs past this is prose
 *  that belongs in the chapter, and an unbounded body is a way to grow the
 *  database from a stuck client. */
const MAX_BODY = 4000

export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const summary = await prisma.chapterSummary.findUnique({ where: { chapterId } })
  // No row reads as an empty summary rather than a 404 — the row comes into
  // existence the first time the writer types something.
  return NextResponse.json({ body: summary?.body ?? '' })
}

export async function PUT(req: Request, { params }: Params) {
  const { chapterId } = await params

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const body = (payload as { body?: unknown } | null)?.body
  if (typeof body !== 'string') {
    return NextResponse.json({ error: 'body must be a string' }, { status: 400 })
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json(
      { error: `summary must be ${MAX_BODY} characters or fewer` },
      { status: 400 },
    )
  }

  try {
    // Emptying is a DELETE of the row, not a row holding "". Otherwise every
    // chapter the writer ever clicked into keeps a blank row forever, and
    // "has a summary" stops being answerable by the row's existence.
    if (body.trim() === '') {
      await prisma.chapterSummary.deleteMany({ where: { chapterId } })
      return NextResponse.json({ body: '' })
    }

    const summary = await prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { chapterId, body },
      update: { body },
    })
    return NextResponse.json({ body: summary.body })
  } catch (err) {
    // P2003 — the chapter was deleted between the tab loading it and this save
    // landing. Nothing to attach the summary to.
    if ((err as { code?: string }).code === 'P2003') {
      return NextResponse.json({ error: 'chapter not found' }, { status: 404 })
    }
    throw err
  }
}
