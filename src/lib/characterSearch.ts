// Searching and ordering WriteAI writer-characters for the dock's Characters
// tab (LOOM-33 / LOOM-44).
//
// Pure on purpose — these are the parts worth testing, and the parts that
// depend on WriteAI's storage shapes, which Loom does not control.
//
// One shape to know: `aliases` is a single comma-separated STRING, not a list
// ("Maknae, Sonja-ya, Jay, Jared Choi"). The row displays it verbatim and
// search splits it, so both live here rather than being re-derived per caller.

import type { WriterCharacterInput, WriterCharacterRelationship } from './writerCharacters'

export type WriterCharacter = WriterCharacterInput
export type { WriterCharacterRelationship }

/** Narrative weight, in the order the story cares about. */
export const CATEGORIES = ['main', 'secondary', 'tertiary'] as const
export type Category = (typeof CATEGORIES)[number]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

/** Aliases as a list, for search and for chip rendering. */
export function aliasList(aliases: string | null | undefined): string[] {
  if (!aliases) return []
  return aliases
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
}

/**
 * Does this character match a search query?
 *
 * Name and aliases only. A character's aliases are how a writer actually
 * reaches for them mid-scene — "Maknae" is the name in the prose even when the
 * record says "Jared Gatlin" — so leaving them out would make search miss the
 * cases it exists for. Traits, goals and arc notes are deliberately excluded:
 * none is shown in the row, so a hit inside one reads as the list returning
 * something arbitrary.
 *
 * Every whitespace-separated term must match, so a second word narrows.
 */
export function matchesQuery(character: WriterCharacter, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${character.name} ${character.aliases ?? ''}`.toLowerCase()
  return terms.every(term => haystack.includes(term))
}

/**
 * Alphabetical by name, reversed on `desc`.
 *
 * This used to lead with the main cast and fall back to name — which looked
 * completely inert, because the name tiebreak stayed ascending in BOTH
 * directions. Every character in one chapter tends to share a category, so
 * flipping the arrow reordered nothing a writer could see.
 *
 * Plain A–Z has the property that matters for a control with two states: the
 * two states always differ. Category is still visible on every card, and is
 * the thing you set rather than the thing you sort by.
 */
export function sortCharacters<T extends WriterCharacter>(
  characters: T[],
  direction: 'asc' | 'desc',
): T[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...characters].sort((a, b) => a.name.localeCompare(b.name) * sign)
}

/**
 * Is this character the chapter's POV?
 *
 * Loom stores POV as free text on the chapter and WriteAI stores the character
 * as a record — there is no id joining them, so this matches on name. That is
 * softer than the rest of the seam, where everything is keyed by id, and it is
 * a deliberate exception: the alternative is no POV marking at all until
 * chapters carry a character id, which is a much larger change for a badge.
 *
 * Normalised the same way cross-app titles are (NFC, curly apostrophes folded,
 * case and surrounding space ignored), so "jared gatlin " still matches. Both
 * sides are hand-typed by the same person, so the realistic mismatch is
 * punctuation or capitalisation rather than a different name.
 *
 * A miss is silent by design: no badge, which is exactly what the card looked
 * like before. Nothing is asserted about a chapter whose POV is a character
 * that does not exist, or is written differently.
 */
export function isPovCharacter(
  character: Pick<WriterCharacter, 'name'>,
  pov: string | null | undefined,
): boolean {
  if (!pov?.trim()) return false
  const norm = (v: string) => v.normalize('NFC').replace(/[\u2018\u2019]/g, "'").trim().toLowerCase()
  return norm(character.name) === norm(pov)
}

/**
 * Narrative weight first, then name — the CAST-LIST order (LOOM-88).
 *
 * A cast list is read top-down looking for someone specific, and "who matters
 * in this book" is what makes that quick; alphabetical puts a one-scene
 * teacher above the protagonist. Uncategorised characters sort last rather
 * than first: no category means nobody has said yet, not "least important",
 * and the top of the list is the part that has to stay meaningful.
 *
 * Deliberately NOT what `sortCharacters` above does. That list has a direction
 * toggle, and sorting it by category made the toggle look inert, because every
 * character in one chapter tends to share a category. Two lists, two jobs.
 */
const categoryWeight = (category: string | null | undefined) => {
  const i = CATEGORIES.indexOf(category as Category)
  return i === -1 ? CATEGORIES.length : i
}

export function byCategoryThenName(
  a: { name: string; category: string | null },
  b: { name: string; category: string | null },
): number {
  return categoryWeight(a.category) - categoryWeight(b.category) || a.name.localeCompare(b.name)
}
