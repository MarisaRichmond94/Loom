import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string; writerCharacterId: string }> }

/**
 * Untag a character from this chapter (LOOM-33).
 *
 * Removes the LINK only. The character lives in WriteAI and is untouched —
 * deleting one is a different, far more destructive action that belongs to
 * the authoring modal, not to a hover ✕ in a list.
 *
 * Idempotent: untagging something already untagged is 200, not 404. The caller
 * asked for the tag to be gone and it is gone, and a stale sidebar retrying
 * should not raise an error for a state the user already has.
 */
export async function DELETE(_: Request, { params }: Params) {
  const { chapterId, writerCharacterId } = await params
  const { count } = await prisma.chapterCharacter.deleteMany({
    where: { chapterId, writerCharacterId },
  })
  return NextResponse.json({ removed: count > 0 })
}

/**
 * Flip a tag between canon and non-canon (LOOM-63).
 *
 * A separate verb from POST because this is a property of an EXISTING tag, not
 * a second way to create one — and because POST is idempotent-by-constraint,
 * so re-posting with a different flag would have to decide whether to update,
 * which is exactly the "assume replace, not merge" ambiguity this codebase has
 * been bitten by three times.
 *
 * Updates nothing if the tag is gone: the sidebar can be a moment stale, and
 * resurrecting a deleted tag because someone toggled a switch on a card that
 * no longer exists would be worse than the no-op.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { chapterId, writerCharacterId } = await params

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const nonCanon = (payload as { nonCanon?: unknown })?.nonCanon
  if (typeof nonCanon !== 'boolean') {
    return NextResponse.json({ error: 'nonCanon must be a boolean' }, { status: 400 })
  }

  const { count } = await prisma.chapterCharacter.updateMany({
    where: { chapterId, writerCharacterId },
    data: { nonCanon },
  })
  if (count === 0) return NextResponse.json({ error: 'tag not found' }, { status: 404 })
  return NextResponse.json({ writerCharacterId, nonCanon })
}
