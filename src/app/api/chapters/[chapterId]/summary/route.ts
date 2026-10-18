import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

// The writer's own summary for a chapter (LOOM-120; the outline board since
// the Outline/Chapters merge).
//
// Sibling of ../notes, and the same upsert shape — but a different field for a
// different job. Notes are the private scratchpad; this is the description that
// renders on the outline board's card.
//
// The writer's summary ALWAYS wins over WriteAI's generated one. The row has
// three states, and the board reads all three:
//
//   no row         — the writer has never touched this card. It shows WriteAI's
//                    summary if there is one (the "AI generated" badge).
//   body non-empty — the writer's summary. Shown instead of WriteAI's, always.
//   body ""        — the writer chose the AI summary (Sync, or cleared their
//                    own). Same display as no row, but it also suppresses any
//                    LEGACY summary the writer once typed into WriteAI's own
//                    outline card, which the board otherwise treats as theirs.
//
// This endpoint writes one row in one Loom-owned table and cannot reach the
// manuscript, the canon export, or WriteAI.

/** Generous, but not unbounded — a card summary that runs past this is prose
 *  that belongs in the chapter, and an unbounded body is a way to grow the
 *  database from a stuck client. Sized for HTML: the card editor stores rich
 *  text, whose markup roughly doubles a summary's length. */
const MAX_BODY = 20000

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
    // Emptying keeps the row, holding "" — the "use the AI summary" state
    // described above. Deleting it instead would let a legacy WriteAI-side
    // summary reappear the moment the writer cleared their own.
    if (body.trim() === '') {
      await prisma.chapterSummary.upsert({
        where: { chapterId },
        create: { chapterId, body: '' },
        update: { body: '' },
      })
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
