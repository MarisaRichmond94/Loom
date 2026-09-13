// The non-canon half of the outline endpoints (LOOM-153, under LOOM-146).
//
// ⚠️ NOTHING HERE TALKS TO WRITEAI, despite living under /api/writeai. The
// client has one outline URL and this is the branch it takes for a non-canon
// book, so the routing decision stays on the server where the canon flag is
// authoritative — rather than trusting a client to ask the right endpoint.
//
// Storage and derivation rules live in lib/localOutline.ts; this is only the
// request handling.

import { prisma } from '@/lib/prisma'
import {
  buildLocalOutline,
  nextPlaceholderPosition,
  isPlaceholderCardId,
  placeholderIdFromCardId,
} from '@/lib/localOutline'
import type { OutlineCard } from '@/lib/writerOutline'

/** Chapters + their summaries + the book's placeholders, as one outline. */
export async function localOutlineResponse(bookId: string) {
  const [chapters, placeholders] = await Promise.all([
    prisma.chapter.findMany({
      where: { bookId },
      orderBy: { order: 'asc' },
      select: {
        id: true, title: true, order: true, pov: true, date: true, numbered: true,
        summary: { select: { body: true } },
      },
    }),
    prisma.bookOutlinePlaceholder.findMany({
      where: { bookId },
      orderBy: { position: 'asc' },
    }),
  ])

  return Response.json({
    outline: {
      chapters: buildLocalOutline(chapters, placeholders),
      // There is no upstream to be behind. Reported rather than omitted so the
      // client's banner logic has a defined value instead of 'unknown'.
      sync_state: 'synced',
      local: true,
    },
    // No WriteAI number exists for a book WriteAI has never seen. -1 is what
    // the client already treats as "none".
    writeaiNumber: -1,
  })
}

/**
 * Apply an edited card list.
 *
 * ⚠️ Deliberately NOT the whole-list replace the WriteAI path performs. The
 * upstream store offers no per-card write, which is why that path has to send
 * everything and why a partial body there DELETES the difference. Nothing
 * forces that shape here, so this writes only what actually changed and a card
 * missing from the body is left alone rather than destroyed.
 *
 * Chapter-backed cards are derived, so only their SUMMARY is writable — it goes
 * to ChapterSummary. A heading here would be a chapter rename, which belongs to
 * the outline tree and the editor, not to a planning board.
 */
export async function localOutlineApply(bookId: string, cards: OutlineCard[]) {
  const chapterIds = new Set(
    (await prisma.chapter.findMany({ where: { bookId }, select: { id: true } })).map(c => c.id),
  )
  const placeholderIds = new Set(
    (await prisma.bookOutlinePlaceholder.findMany({ where: { bookId }, select: { id: true } }))
      .map(p => p.id),
  )

  const writes: Promise<unknown>[] = []
  for (const card of cards) {
    if (isPlaceholderCardId(card.id)) {
      const id = placeholderIdFromCardId(card.id)
      // Scoped to this book, so a card id from elsewhere cannot be written
      // through this book's endpoint.
      if (!placeholderIds.has(id)) continue
      writes.push(prisma.bookOutlinePlaceholder.update({
        where: { id },
        data: {
          position: card.position,
          heading: card.heading ?? '',
          pov: card.pov ?? '',
          date: card.date ?? null,
          summary: card.writer_summary ?? '',
          notes: card.notes ?? null,
        },
      }))
      continue
    }

    if (!chapterIds.has(card.id)) continue
    const body = card.writer_summary ?? ''
    writes.push(prisma.chapterSummary.upsert({
      where: { chapterId: card.id },
      create: { chapterId: card.id, body },
      update: { body },
    }))
  }

  await prisma.$transaction(writes as never)
  return localOutlineResponse(bookId)
}

/** Add a planned card between two existing positions. */
export async function localOutlineAddCard(bookId: string, position: number, heading: string) {
  const existing = await prisma.bookOutlinePlaceholder.findMany({
    where: { bookId },
    select: { position: true },
  })
  const chapters = await prisma.chapter.count({ where: { bookId } })
  const taken = [
    ...existing.map(p => p.position),
    ...Array.from({ length: chapters }, (_, i) => i + 1),
  ]
  const card = await prisma.bookOutlinePlaceholder.create({
    data: { bookId, position: nextPlaceholderPosition(position, taken), heading },
  })
  return Response.json({ id: card.id })
}

/**
 * Remove a card.
 *
 * A chapter-backed card cannot be deleted: the card IS the chapter, and a
 * planning board must not delete prose. Its summary can be cleared instead,
 * which is what "remove this from the board" actually means here.
 */
export async function localOutlineDeleteCard(bookId: string, cardId: string) {
  if (!isPlaceholderCardId(cardId)) {
    return Response.json(
      { error: 'This card is a chapter. Delete the chapter from the outline tree, or clear its summary.' },
      { status: 409 },
    )
  }
  const id = placeholderIdFromCardId(cardId)
  const deleted = await prisma.bookOutlinePlaceholder.deleteMany({ where: { id, bookId } })
  if (deleted.count === 0) return Response.json({ error: 'No such card.' }, { status: 404 })
  return Response.json({ ok: true })
}
