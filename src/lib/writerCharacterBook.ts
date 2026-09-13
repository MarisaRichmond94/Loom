// Resolve a book's cast from the three places it now lives — LOOM-88, under
// LOOM-5.
//
// A cast card needs WriteAI's record (who they are), Loom's overlay (what they
// are in this series) and Loom's per-book row (what they are in THIS book).
// Every route that renders a cast list needs the same join, so it lives here
// rather than being rebuilt per route — the Character-era version was copied
// between two routes and drifted.
//
// ⚠️ Reads the SNAPSHOT, never `/api/writeai/characters`. That endpoint writes
// to disk on WriteAI's side, and these functions run on page renders.

import { prisma } from '@/lib/prisma'
import { publicDirFilenames } from '@/lib/publicAssets'
import {
  resolveWriterCharacter,
  type BookPosition,
  type ResolvedWriterCharacter,
} from '@/lib/resolveWriterCharacter'
import { byCategoryThenName } from '@/lib/characterSearch'

/**
 * Every writer character resolved for one book.
 *
 * Returns characters WriteAI knows about, whether or not Loom holds an overlay
 * row for them — a character created in WriteAI five minutes ago belongs in
 * the cast immediately, not once someone has edited it in Loom.
 *
 * `visible` is returned rather than applied: the author's grid wants to see
 * characters hidden by a later first-appearance so they can be edited, and the
 * reader's page filters them out itself. Same division as before.
 */
export async function resolveWriterCharactersForBook(
  bookId: string,
): Promise<{ error: 'book-not-found' } | { characters: ResolvedWriterCharacter[] }> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, order: true, seriesId: true, canon: true, divergesFromBookId: true },
  })
  if (!book) return { error: 'book-not-found' }

  const [snapshots, metas, bookMetas, books, tags, avatarFiles] = await Promise.all([
    prisma.writerCharacterSnapshot.findMany({ orderBy: { name: 'asc' } }),
    prisma.writerCharacterMeta.findMany({ where: { seriesId: book.seriesId } }),
    prisma.writerCharacterBookMeta.findMany({
      where: { bookId },
      include: { meta: { select: { writerCharacterId: true } } },
    }),
    prisma.book.findMany({
      where: { seriesId: book.seriesId },
      select: { id: true, order: true, canon: true, divergesFromBookId: true },
    }),
    // Who is actually tagged in this book's chapters. nonCanon tags COUNT
    // here: a character who only appears down a branch is still part of this
    // book's cast as far as the writer is concerned — the exclusion of
    // non-canon tags exists for WriteAI's benefit, not the author's grid.
    prisma.chapterCharacter.findMany({
      where: { chapter: { bookId } },
      select: { writerCharacterId: true },
    }),
    publicDirFilenames('characters'),
  ])

  // Book positions, not bare orders (LOOM-147): the first/death/last rules need
  // to know whether a book is canon and where a non-canon one branches off, and
  // an order carries neither.
  const orderByBookId = new Map(books.map(b => [b.id, b.order]))
  const positionOf = (id: string | null | undefined): BookPosition | null => {
    if (!id) return null
    const b = books.find(x => x.id === id)
    if (!b) return null
    return {
      id: b.id,
      order: b.order,
      canon: b.canon,
      divergesFromOrder: b.divergesFromBookId
        ? orderByBookId.get(b.divergesFromBookId) ?? null
        : null,
    }
  }
  const here = positionOf(book.id)!

  const metaByWc = new Map(metas.map(m => [m.writerCharacterId, m]))
  const bookMetaByWc = new Map(bookMetas.map(b => [b.meta.writerCharacterId, b]))
  const taggedIds = new Set(tags.map(t => t.writerCharacterId))

  const characters = snapshots
    .map(snapshot => {
      const meta = metaByWc.get(snapshot.writerCharacterId) ?? null
      return resolveWriterCharacter({
        snapshot,
        meta,
        bookMeta: bookMetaByWc.get(snapshot.writerCharacterId) ?? null,
        book: here,
        firstBook: positionOf(meta?.firstBookId),
        deathBook: positionOf(meta?.deathBookId),
        lastBook: positionOf(meta?.lastBookId),
        taggedInBook: taggedIds.has(snapshot.writerCharacterId),
        avatarFiles,
      })
    })
    .filter((c): c is ResolvedWriterCharacter => c !== null)
    .sort(byCategoryThenName)

  return { characters }
}

/** One resolved character, for returning after a write. */
export async function resolveOneWriterCharacterForBook(
  bookId: string,
  writerCharacterId: string,
): Promise<ResolvedWriterCharacter | null> {
  const result = await resolveWriterCharactersForBook(bookId)
  if ('error' in result) return null
  return result.characters.find(c => c.id === writerCharacterId) ?? null
}
