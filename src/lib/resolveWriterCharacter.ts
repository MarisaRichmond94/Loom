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
  book: { id: string; order: number }
  firstBookOrder: number | null
  deathBookOrder: number | null
  lastBookOrder: number | null
  // Filenames in /public/characters, listed once per request by the caller
  // (publicDirFilenames) — keeps this pure and avoids a sync fs stat per
  // character.
  avatarFiles: Set<string>
}): ResolvedWriterCharacter | null {
  const { snapshot, meta, bookMeta, book, firstBookOrder, deathBookOrder, lastBookOrder, avatarFiles } = opts
  if (!snapshot) return null

  const id = snapshot.writerCharacterId
  const hasBookAvatar = avatarFiles.has(`${id}-${book.id}.jpg`)
  const hasCanonicalAvatar = avatarFiles.has(`${id}.jpg`)

  // A character with no meta row is a WriteAI character Loom has never been
  // told anything about. They are visible everywhere, un-aged and unstarred —
  // which is exactly right: absence of an overlay is not absence from the
  // story, and the alternative (hiding them) would make every newly created
  // character invisible until someone edited it.
  const visible = firstBookOrder == null || book.order >= firstBookOrder
  const deceased = deathBookOrder != null && book.order > deathBookOrder
  const hidden = lastBookOrder != null && book.order > lastBookOrder

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
    visible,
    deceased,
    hidden,
  }
}
