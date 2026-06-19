import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

// Persists a chapter reordering computed on the client. The client is
// responsible for the per-prefix sequential renumbering (it knows which
// chapter the writer just dragged and which prefix to renumber); the
// server only persists what it's told. The previous server-side
// `setTitle` heuristic rewrote "Chapter N" to match the chapter's
// absolute order in the book — which double-counted Prologue and Bonus
// Chapters, leading to title jumps like "Chapter 46 → Chapter 55"
// after a Bonus Chapter move.
//
// `title` is optional in the payload so legacy callers (or callers
// that genuinely just want to shuffle order without renaming) keep
// working — when omitted, only the order is updated.
export async function PATCH(req: Request, { params }: Params) {
  await params
  const items: { id: string; order: number; title?: string }[] = await req.json()
  await prisma.$transaction(
    items.map(({ id, order, title }) =>
      prisma.chapter.update({
        where: { id },
        data: {
          order,
          ...(typeof title === 'string' ? { title } : {}),
        },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
