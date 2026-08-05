// Resolve a series' whole cast — LOOM-104, under LOOM-5.
//
// The series-scope sibling of writerCharacterBook.ts. That one answers "who is
// in THIS book, and what are they in it"; this answers "who exists in this
// series at all".
//
// ⚠️ Reads the SNAPSHOT, never `/api/writeai/characters`. That endpoint writes
// to disk on WriteAI's side — it seeds from canon, prunes entries canon
// reclassifies, and rewrites `books` — and this runs on a page render.
//
// ── What is and is not well defined at series scope ──────────────────────────
//
// LOOM-104 was written believing `starred`, `firstBookId`, `deathBookId` and
// `lastBookId` were per-book overlays with no series-level value. They are not.
// They live on WriterCharacterMeta, which is keyed by (seriesId,
// writerCharacterId) — one row per character per SERIES. `starred` even says so
// outright: "not gated per book — once primary, always primary".
//
// The only genuinely per-book overlay is `age`, on WriterCharacterBookMeta,
// which exists solely to override the series default. So the fields returned
// here are exact, not aggregated, and nothing is being flattened or guessed.
//
// What is still book-relative, and therefore absent: `deceased`, `visible` and
// `taggedInBook`. Those are computed by comparing a book's order against the
// first/death/last range, so they answer "dead by book 4", not "dead". The
// range itself is returned instead, which is the honest form of the same fact.

import { prisma } from '@/lib/prisma'
import { publicDirFilenames } from '@/lib/publicAssets'
import { byCategoryThenName } from '@/lib/characterSearch'

/** One book a character is tagged in somewhere. */
export type CharacterBookAppearance = {
  bookId: string
  bookTitle: string
  /** Book.order — reading order, so a cast line lists books as they're read. */
  bookOrder: number
}

export type SeriesWriterCharacter = {
  id: string
  // ── WriteAI's, read-only here ──
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  writerPhotoUrl: string | null
  // ── Loom's, series-level and exact ──
  /** Series default. A book may override it; that override is not shown here. */
  age: number | null
  starred: boolean
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  /** Loom holds an overlay row — someone has said something about this
   *  character at some point. Distinguishes "no age set" from "no row". */
  hasOverlay: boolean
  /** A canonical portrait file exists in Loom's public/characters. There is no
   *  per-book portrait at series scope, so the chain is canonical → WriteAI. */
  hasCanonicalAvatar: boolean
  /** Books this character is tagged in, in reading order. Empty is meaningful:
   *  WriteAI knows them, but no chapter in this series references them yet. */
  appearsIn: CharacterBookAppearance[]
}

/**
 * Every writer character in a series, deduplicated — a character in four books
 * appears once.
 *
 * Returns characters WriteAI knows about whether or not Loom holds an overlay
 * row for them, matching the book resolver: a character created in WriteAI five
 * minutes ago belongs in the cast immediately, not once someone has edited it
 * in Loom.
 */
export async function resolveWriterCharactersForSeries(
  seriesId: string,
): Promise<{ error: 'series-not-found' } | { characters: SeriesWriterCharacter[] }> {
  const series = await prisma.series.findUnique({ where: { id: seriesId }, select: { id: true } })
  if (!series) return { error: 'series-not-found' }

  const [snapshots, metas, books, tags, avatarFiles] = await Promise.all([
    prisma.writerCharacterSnapshot.findMany({ orderBy: { name: 'asc' } }),
    prisma.writerCharacterMeta.findMany({ where: { seriesId } }),
    prisma.book.findMany({
      where: { seriesId },
      select: { id: true, title: true, order: true },
      orderBy: { order: 'asc' },
    }),
    // Who is tagged where, across the whole series. nonCanon tags COUNT, as in
    // the book resolver: a character who only appears down a branch is still
    // part of the cast as far as the writer is concerned. Excluding non-canon
    // exists for WriteAI's benefit, not the author's own grid.
    prisma.chapterCharacter.findMany({
      select: { writerCharacterId: true, chapter: { select: { bookId: true } } },
      where: { chapter: { book: { seriesId } } },
    }),
    publicDirFilenames('characters'),
  ])

  const bookById = new Map(books.map(b => [b.id, b]))
  const metaByWc = new Map(metas.map(m => [m.writerCharacterId, m]))

  // Character -> the set of books it is tagged in. A character tagged in twenty
  // chapters of one book yields one entry, which is the whole point of the tab.
  const appearancesByWc = new Map<string, Set<string>>()
  for (const tag of tags) {
    const set = appearancesByWc.get(tag.writerCharacterId) ?? new Set<string>()
    set.add(tag.chapter.bookId)
    appearancesByWc.set(tag.writerCharacterId, set)
  }

  const characters = snapshots
    .map<SeriesWriterCharacter>(snapshot => {
      const meta = metaByWc.get(snapshot.writerCharacterId) ?? null
      const appearsIn = [...(appearancesByWc.get(snapshot.writerCharacterId) ?? [])]
        .map(bookId => bookById.get(bookId))
        .filter((b): b is { id: string; title: string; order: number } => Boolean(b))
        .sort((a, b) => a.order - b.order)
        .map(b => ({ bookId: b.id, bookTitle: b.title, bookOrder: b.order }))

      return {
        id: snapshot.writerCharacterId,
        name: snapshot.name,
        category: snapshot.category,
        role: snapshot.role,
        aliases: snapshot.aliases,
        writerPhotoUrl: snapshot.photoUrl,
        age: meta?.age ?? null,
        starred: meta?.starred ?? false,
        firstBookId: meta?.firstBookId ?? null,
        deathBookId: meta?.deathBookId ?? null,
        lastBookId: meta?.lastBookId ?? null,
        hasOverlay: meta !== null,
        hasCanonicalAvatar: avatarFiles.has(`${snapshot.writerCharacterId}.jpg`),
        appearsIn,
      }
    })
    .sort(byCategoryThenName)

  return { characters }
}
