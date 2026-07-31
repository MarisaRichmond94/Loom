import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorJumpTarget } from '@/lib/crossAppJump'

// Companion-app jump target, id-addressed (KAN-12).
//
// The stable counterpart to /author/by-title/[title]. WriteAI now carries
// Loom's series cuid (read from the manifest sidecar), so it can link here and
// the jump survives a rename — which the title route cannot.
//
// Not the same as simply linking to /author/[seriesId]: this resolves the
// chapter the writer last had open, so the jump resumes work. That shared
// behaviour lives in crossAppJump so the two variants can't drift.
//
// An unknown id falls through to the Write page, matching the title route's
// soft landing.

type Params = { params: Promise<{ seriesId: string }> }

export async function GET(req: Request, { params }: Params) {
  const { seriesId } = await params
  const exists = await prisma.series.findUnique({
    where: { id: decodeURIComponent(seriesId) },
    select: { id: true },
  })
  if (!exists) return NextResponse.redirect(new URL('/', req.url))
  return NextResponse.redirect(new URL(await authorJumpTarget(exists.id), req.url))
}
