import { NextResponse } from 'next/server'
import { setHidden, setResolved } from '@/lib/readerComments'

/**
 * Resolve and Hide (LOOM-135) — the author's only two actions, and the only
 * place Loom writes a comment row.
 *
 *   resolved → author bookkeeping. Readers never see it.
 *   hidden   → moderation. Removes it from the reader-facing thread.
 *
 * Both are reversible, and NEITHER deletes. There is no DELETE handler in this
 * file on purpose: a family member's words should not be destroyable from a
 * dock that is one mis-click away from the writing surface.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    resolved?: boolean
    hidden?: boolean
  }

  if (typeof body.resolved === 'boolean') setResolved(id, body.resolved)
  if (typeof body.hidden === 'boolean') setHidden(id, body.hidden)

  return new NextResponse(null, { status: 204 })
}
