// Validation for the WriteAI writer-character proxy (LOOM-33 / LOOM-43).
//
// ⚠️ This is the sharpest of the three replace-not-merge endpoints in the
// seam. WriteAI's `PUT /api/plan/characters/{char_id}` takes a RAW DICT with
// no Pydantic model at all and stores it verbatim (`chars[i] = body`), so an
// omitted key does not reset to a default the way the event PATCH does — it
// DISAPPEARS from the record. Editing a name could silently drop a character's
// traits, relationships and books, with a 200 and nothing to see.
//
// So every write from Loom carries the complete character, and this refuses
// anything short before it can reach WriteAI. Compare writerEvents.ts, where
// the same hazard exists in a milder form.

export type WriterCharacterRelationship = { target: string; nature: string }

export type WriterCharacterInput = {
  id: string
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  traits: string[]
  arc_notes: string | null
  goals: string | null
  relationships: WriterCharacterRelationship[]
  books: string[]
  photo_url: string | null
}

const isStringArray = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string')

const isRelationships = (v: unknown) =>
  Array.isArray(v) &&
  v.every(
    r =>
      r !== null &&
      typeof r === 'object' &&
      typeof (r as WriterCharacterRelationship).target === 'string' &&
      typeof (r as WriterCharacterRelationship).nature === 'string',
  )

/**
 * Fields that must be PRESENT on a write, and what counts as valid.
 *
 * Absent is the dangerous state, not null: `role`, `arc_notes`, `goals`,
 * `aliases`, `category` and `photo_url` are all legitimately null on real
 * characters, and refusing null would block saving a character who simply has
 * no stated goal. Absent means "I forgot this field", which WriteAI turns into
 * "delete it".
 */
const FIELDS: { key: keyof WriterCharacterInput; ok: (v: unknown) => boolean; expected: string }[] = [
  { key: 'id', ok: v => typeof v === 'string' && v.length > 0, expected: 'a non-empty string' },
  { key: 'name', ok: v => typeof v === 'string' && v.trim().length > 0, expected: 'a non-empty string' },
  { key: 'category', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'role', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'aliases', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'traits', ok: isStringArray, expected: 'array of strings' },
  { key: 'arc_notes', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'goals', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'relationships', ok: isRelationships, expected: 'array of {target, nature}' },
  { key: 'books', ok: isStringArray, expected: 'array of strings' },
  { key: 'photo_url', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
]

/** Validate a full character body. */
export function validateWriterCharacter(
  payload: unknown,
): { character: WriterCharacterInput } | { error: string } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'body must be an object' }
  }
  const obj = payload as Record<string, unknown>

  const missing = FIELDS.filter(f => obj[f.key] === undefined).map(f => f.key)
  if (missing.length) {
    return {
      error:
        'refusing to write an incomplete character — WriteAI stores the body ' +
        `verbatim, so this would delete: ${missing.join(', ')}`,
    }
  }

  const wrong = FIELDS.filter(f => !f.ok(obj[f.key]))
  if (wrong.length) {
    return { error: wrong.map(f => `${f.key} must be ${f.expected}`).join('; ') }
  }

  return {
    character: {
      id: obj.id as string,
      name: obj.name as string,
      category: obj.category as string | null,
      role: obj.role as string | null,
      aliases: obj.aliases as string | null,
      traits: obj.traits as string[],
      arc_notes: obj.arc_notes as string | null,
      goals: obj.goals as string | null,
      relationships: obj.relationships as WriterCharacterRelationship[],
      books: obj.books as string[],
      photo_url: obj.photo_url as string | null,
    },
  }
}

/**
 * A character id safe to put in a URL path.
 *
 * Mirrors the guard now in WriteAI's `upload_character_photo`. Checks filename
 * safety rather than id format on purpose: ids are mostly `wc-<hex>`, but at
 * least one real character predates that convention (`draft-<ms>`), and
 * pinning the shape would lock a live record out while stopping nothing.
 */
export function isSafeCharacterId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/**
 * The minimum a picker needs to offer a character and store a reference to it
 * (LOOM-45).
 *
 * Both halves are load-bearing and neither is optional: the NAME is what the
 * writer searches and reads, the ID is the only part that survives a rename.
 * Pools used to carry names alone, which is exactly how an event's cast came to
 * orphan itself the moment a character was renamed.
 */
export type CharacterOption = { id: string; name: string }
