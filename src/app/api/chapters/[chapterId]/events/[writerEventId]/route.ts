import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string; writerEventId: string }> }

/**
 * Untag an event from this chapter (LOOM-32).
 *
 * Removes the LINK only. The event itself lives in WriteAI and is untouched —
 * deleting an event is a different, destructive action that belongs to the
 * authoring modal, not to a hover ✕ in a list.
 *
 * Idempotent: untagging something already untagged is 200, not 404. The caller
 * asked for the tag to be gone and it is gone, and a stale sidebar retrying
 * should not surface an error for a state the user already has.
 */
export async function DELETE(_: Request, { params }: Params) {
  const { chapterId, writerEventId } = await params
  const { count } = await prisma.chapterEvent.deleteMany({
    where: { chapterId, writerEventId },
  })
  return NextResponse.json({ removed: count > 0 })
}
