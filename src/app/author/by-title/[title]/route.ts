import { NextResponse } from 'next/server'
import { authorJumpTarget, seriesIdForTitle } from '@/lib/crossAppJump'

// Companion-app jump target, title-addressed.
//
// Superseded by /author/by-id/[seriesId] (KAN-12) but deliberately kept: links
// already saved in the wild are title-based, and a title is still the only
// thing an older WriteAI build can express. Renaming a series breaks this
// route and does not break the by-id one — which is the argument for stable
// ids in one sentence.
//
// Note: title matching now goes through the shared normalizeTitle (NFC +
// curly-apostrophe folding) rather than this route's old plain
// trim/lowercase. Strictly more permissive, and it makes this route agree
// with the reader-side one, which always normalized that way.
//
// No match falls through to the Write page, which lists every series — a soft
// landing rather than a 404 if the two apps' names ever drift apart.

type Params = { params: Promise<{ title: string }> }

export async function GET(req: Request, { params }: Params) {
  const { title } = await params
  const seriesId = await seriesIdForTitle(decodeURIComponent(title))
  if (!seriesId) return NextResponse.redirect(new URL('/', req.url))
  return NextResponse.redirect(new URL(await authorJumpTarget(seriesId), req.url))
}
