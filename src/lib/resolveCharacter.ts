import { existsSync } from 'fs'
import path from 'path'

// Shape of the database row before we apply any book-scoped resolution.
export type CanonicalCharacter = {
  id: string
  name: string
  age: number | null
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  starred: boolean
}

export type CharacterOverrideRow = {
  age: number | null
}

export type ResolvedCharacter = {
  id: string
  name: string
  age: number | null
  firstBookId: string | null
  deathBookId: string | null
  lastBookId: string | null
  starred: boolean
  // True when either a book-specific avatar file or the canonical one exists.
  hasAvatar: boolean
  hasBookAvatar: boolean
  hasCanonicalAvatar: boolean
  // Override is currently age-only; the boolean tells the UI whether the
  // "reset to series default" affordance is meaningful.
  hasOverride: boolean
  // False when the character's firstBookId is set and the current book sits
  // before it in series order — caller filters these out of the book grid.
  visible: boolean
  // True only in books strictly *after* the death book — the death book
  // itself shows the character normally (no spoiler tag), and earlier books
  // are also unaffected.
  deceased: boolean
  // True only in books strictly *after* the lastBook — the author sees these
  // in their own grid with an indicator; the reader filters them out.
  hidden: boolean
}

// Path to the canonical and book-specific avatar files on disk.
// Avatars live at /public/characters/<id>.jpg (canonical) or
// /public/characters/<id>-<bookId>.jpg (book-specific override).
export function characterAvatarPaths(characterId: string, bookId: string): {
  canonical: string
  bookSpecific: string
} {
  const charsDir = path.join(process.cwd(), 'public', 'characters')
  return {
    canonical: path.join(charsDir, `${characterId}.jpg`),
    bookSpecific: path.join(charsDir, `${characterId}-${bookId}.jpg`),
  }
}

// Merges canonical character data with any book-specific override and the
// current book context. The returned shape is what the book page and the
// reader's hover card consume.
export function resolveCharacter(opts: {
  character: CanonicalCharacter
  override: CharacterOverrideRow | null
  book: { id: string; order: number }
  firstBookOrder: number | null
  deathBookOrder: number | null
  lastBookOrder: number | null
}): ResolvedCharacter {
  const { character, override, book, firstBookOrder, deathBookOrder, lastBookOrder } = opts
  const paths = characterAvatarPaths(character.id, book.id)
  const hasBookAvatar = existsSync(paths.bookSpecific)
  const hasCanonicalAvatar = existsSync(paths.canonical)
  const visible = firstBookOrder == null || book.order >= firstBookOrder
  const deceased = deathBookOrder != null && book.order > deathBookOrder
  const hidden = lastBookOrder != null && book.order > lastBookOrder
  return {
    id: character.id,
    name: character.name,
    age: override?.age ?? character.age,
    firstBookId: character.firstBookId,
    deathBookId: character.deathBookId,
    lastBookId: character.lastBookId,
    starred: character.starred,
    hasAvatar: hasBookAvatar || hasCanonicalAvatar,
    hasBookAvatar,
    hasCanonicalAvatar,
    hasOverride: override != null,
    visible,
    deceased,
    hidden,
  }
}
