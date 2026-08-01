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
