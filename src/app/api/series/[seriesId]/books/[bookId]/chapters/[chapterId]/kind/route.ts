import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { planChapterKindChange, type ChapterKind } from '@/lib/chapterNumbering'

type Params = { params: Promise<{ seriesId: string; bookId: string; chapterId: string }> }

// Turn the book's first chapter into its Prologue or its last into its Epilogue,
// and back (the outline board's hover toggle).
//
// Server-side and in ONE transaction, unlike a drag, whose renumbering the
// client computes: this one rewrites the target's `numbered` flag as well as
// titles, and a half-applied change — a "Prologue" still counted as chapter 1,
// or every later title shifted with the target unchanged — is a manuscript
// whose headings disagree with its sidebar. The rules themselves are pure and
// live in lib/chapterNumbering.ts.
//
// The plan is computed from the database's CURRENT order, never from the
// client's idea of it, so a stale board can at worst be refused (409), never
// applied to the wrong chapter.

const KINDS: ChapterKind[] = ['prologue', 'epilogue', 'chapter']

export async function PATCH(req: Request, { params }: Params) {
  const { seriesId, bookId, chapterId } = await params
  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null
  const kind = body?.kind
  if (typeof kind !== 'string' || !KINDS.includes(kind as ChapterKind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
  }

  const book = await prisma.book.findFirst({ where: { id: bookId, seriesId }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 })

  const chapters = await prisma.chapter.findMany({
    where: { bookId },
    select: { id: true, title: true, order: true },
  })
  const plan = planChapterKindChange(chapters, chapterId, kind as ChapterKind)
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 409 })

  await prisma.$transaction(
    plan.updates.map(u =>
      prisma.chapter.update({
        where: { id: u.id },
        data: { title: u.title, ...(u.numbered !== undefined && { numbered: u.numbered }) },
      }),
    ),
  )
  return NextResponse.json({ ok: true, updates: plan.updates })
}
