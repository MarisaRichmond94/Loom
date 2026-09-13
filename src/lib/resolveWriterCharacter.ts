// Resolve a WriteAI writer-character for one book — LOOM-86, under LOOM-5.
//
// The direct successor to resolveCharacter.ts, which does the same job for
// Loom's native Character model. Both exist until LOOM-90 retires the old one.
//
// The split this file embodies: WriteAI owns who a character IS (name,
// category, aliases, traits, the default portrait), Loom owns what they are in
// a given BOOK (age, first appearance, death, hidden-after, starred, per-book
// portrait). Neither app can answer a cast-list question alone; this merges
// them.
//
// Pure, like its predecessor — the caller does the I/O (one snapshot query,
// one meta query, one directory listing) and passes the results in. That keeps
// the book-order rules, which are the part worth testing, testable without a
// database.

import path from 'path'

/** A row from WriterCharacterSnapshot — WriteAI's half, cached locally. */
export type WriterCharacterSnapshotRow = {
  writerCharacterId: string
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  photoUrl: string | null
}

/** A row from WriterCharacterMeta — Loom's half. */
export type WriterCharacterMetaRow = {
  age: number | null
  starred: boolean
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
}

/** A row from WriterCharacterBookMeta, for the book being resolved. */
export type WriterCharacterBookMetaRow = {
  age: number | null
}

/**
 * A book's identity and where it sits in the story — LOOM-147, under LOOM-146.
 *
 * Replaces the bare `number` orders these rules used to compare. `Book.order`
 * is a total order over the series, but it is only a STORY order along one
 * line: a non-canon book sorts beneath every canon book, so its raw order says
 * nothing about when it happens.
 */
export type BookPosition = {
  id: string
  order: number
  canon: boolean
  /** `Book.order` of the canon book this one branches off. Null on canon books. */
  divergesFromOrder: number | null
}

/**
 * Where a book sits on the CANON line, which is the only line these ordinal
 * rules can compare along.
 *
 *   - A canon book is at its own order.
 *   - A non-canon book sits immediately after the canon book it branches off,
 *     hence the half-step. An alt book 4 branching off book 3 is at 3.5: after
 *     a death in book 3 (3.5 > 3), before one in canon book 4 (3.5 < 4) — which
 *     is exactly right, since that death is on the other branch and never
 *     happened here.
 *   - A non-canon book whose divergence has not been recorded has no knowable
 *     position. Null, and callers treat that as "cannot say" rather than
 *     guessing — guessing is the bug this function exists to remove.
 */
export function canonPositionOf(book: BookPosition): number | null {
  if (book.canon) return book.order
  if (book.divergesFromOrder == null) return null
  return book.divergesFromOrder + 0.5
}

/**
 * Does a first/death/last pointer at `pointer` say anything about `book`?
 *
 * A pointer at a NON-CANON book is a fact about that branch alone. A character
 * who dies in the alt book is not dead in canon book 5 — that death happened
 * down a path canon book 5 never took. So such a pointer applies only within
 * the very book it names.
 *
 * Without this, a death in an alternate timeline marks a character deceased in
 * every canon book ordered after it, because alt books sort last.
 */
export function pointerApplies(pointer: BookPosition | null, book: BookPosition): boolean {
  if (!pointer) return false
  if (!pointer.canon) return pointer.id === book.id
  return true
}

export type ResolvedWriterCharacter = {
  id: string
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  age: number | null
  starred: boolean
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  // True when either a book-specific portrait file or the canonical one exists
  // in Loom's public/characters.
  hasAvatar: boolean
  hasBookAvatar: boolean
  hasCanonicalAvatar: boolean
  // WriteAI's own portrait, used when Loom holds no file for this character.
  // The fallback CHAIN (book file -> canonical file -> this) is applied by the
  // UI in LOOM-87; this field is what makes the last link possible.
  writerPhotoUrl: string | null
  // Age override present for this book — tells the UI whether "reset to series
  // default" means anything.
  hasOverride: boolean
  // Loom holds an overlay row for this character — someone has said something
  // about them (an age, a star, an appearance range) at some point.
  hasOverlay: boolean
  // Tagged in at least one chapter of THIS book.
  //
  // Together these two answer "does this character belong to this book's cast,
  // or are they just someone WriteAI knows about?" WriteAI's pool spans the
  // whole world of the series — 63 records against the 24 that the book grid
  // used to show — so a grid that lists all of them is noise.
  taggedInBook: boolean
  // False when firstBookId is set and this book sits before it in series
  // order. Callers filter these out.
  visible: boolean
  // True only in books strictly AFTER the death book — the death book itself
  // shows the character normally, no spoiler tag, and earlier books are
  // unaffected.
  deceased: boolean
  // True only in books strictly after lastBookId. The author's grid shows
  // these with an indicator; the reader filters them out.
  hidden: boolean
}

/**
 * Portrait file paths for a writer character.
 *
 * Same layout and precedence as the Character-era files, with the `wc-` id
 * where the cuid used to be: /public/characters/<wc-id>.jpg (canonical) and
 * <wc-id>-<bookId>.jpg (this book only).
 */
export function writerCharacterAvatarPaths(writerCharacterId: string, bookId: string): {
  canonical: string
  bookSpecific: string
} {
  const charsDir = path.join(process.cwd(), 'public', 'characters')
  return {
    canonical: path.join(charsDir, `${writerCharacterId}.jpg`),
    bookSpecific: path.join(charsDir, `${writerCharacterId}-${bookId}.jpg`),
  }
}

/**
 * Merge WriteAI's record, Loom's overlay and the current book.
 *
 * Returns null when there is no snapshot row — a character tagged in prose or
 * held in a meta row that WriteAI no longer has. Callers skip nulls. That is
 * deliberate and silent: a reader page must never fail to render because a
 * cache row is missing, and the same situation in the POV badge has always
 * been a silent miss.
 */
export function resolveWriterCharacter(opts: {
  snapshot: WriterCharacterSnapshotRow | null
  meta: WriterCharacterMetaRow | null
  bookMeta: WriterCharacterBookMetaRow | null
  book: BookPosition
  // The books these pointers name, not their bare orders (LOOM-147). The rules
  // below need to know whether each is canon, which an order cannot carry.
  firstBook: BookPosition | null
  deathBook: BookPosition | null
  lastBook: BookPosition | null
  /** Is this character tagged in a chapter of this book? */
  taggedInBook?: boolean
  // Filenames in /public/characters, listed once per request by the caller
  // (publicDirFilenames) — keeps this pure and avoids a sync fs stat per
  // character.
  avatarFiles: Set<string>
}): ResolvedWriterCharacter | null {
  const { snapshot, meta, bookMeta, book, firstBook, deathBook, lastBook, avatarFiles } = opts
  if (!snapshot) return null

  const id = snapshot.writerCharacterId
  const hasBookAvatar = avatarFiles.has(`${id}-${book.id}.jpg`)
  const hasCanonicalAvatar = avatarFiles.has(`${id}.jpg`)

  // A character with no meta row is a WriteAI character Loom has never been
  // told anything about. They are visible everywhere, un-aged and unstarred —
  // which is exactly right: absence of an overlay is not absence from the
  // story, and the alternative (hiding them) would make every newly created
  // character invisible until someone edited it.
  // All three rules compare positions on the canon line rather than raw
  // Book.order (LOOM-147). `here` is null when this is a non-canon book with no
  // recorded divergence: nothing is knowable about where it sits, so every rule
  // below falls back to its "no information" answer — visible, not deceased,
  // not hidden. Under-reporting, deliberately: showing a character who should
  // be hidden is a cosmetic miss in the author's own grid, while marking a
  // living character dead is the alternate timeline leaking into canon.
  const here = canonPositionOf(book)
  const at = (pointer: BookPosition | null): number | null =>
    pointerApplies(pointer, book) ? canonPositionOf(pointer!) : null

  const firstAt = at(firstBook)
  const deathAt = at(deathBook)
  const lastAt = at(lastBook)

  const visible = firstAt == null || here == null || here >= firstAt
  const deceased = deathAt != null && here != null && here > deathAt
  const hidden = lastAt != null && here != null && here > lastAt

  return {
    id,
    name: snapshot.name,
    category: snapshot.category,
    role: snapshot.role,
    aliases: snapshot.aliases,
    age: bookMeta?.age ?? meta?.age ?? null,
    starred: meta?.starred ?? false,
    firstBookId: meta?.firstBookId ?? null,
    deathBookId: meta?.deathBookId ?? null,
    lastBookId: meta?.lastBookId ?? null,
    hasAvatar: hasBookAvatar || hasCanonicalAvatar,
    hasBookAvatar,
    hasCanonicalAvatar,
    writerPhotoUrl: snapshot.photoUrl,
    hasOverride: bookMeta != null,
    hasOverlay: meta != null,
    taggedInBook: opts.taggedInBook ?? false,
    visible,
    deceased,
    hidden,
  }
}
