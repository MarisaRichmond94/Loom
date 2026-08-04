// Validation for Loom's half of a writer character — LOOM-88, under LOOM-5.
//
// The mirror image of writerCharacters.ts, and deliberately the OPPOSITE
// shape. That file refuses anything incomplete, because WriteAI stores the
// body verbatim and an omitted key is deleted. These fields live in Loom's own
// database, where a partial update is a partial update — so absent means
// "leave it alone" and null means "clear it", which is what a modal editing
// one field at a time actually needs.
//
// Getting that backwards in either direction is a data-loss bug, so the two
// files say so out loud.

export type WriterCharacterMetaPatch = {
  age?: number | null
  starred?: boolean
  firstBookId?: string | null
  deathBookId?: string | null
  lastBookId?: string | null
}

const BOOK_FIELDS = ['firstBookId', 'deathBookId', 'lastBookId'] as const

/**
 * Validate a partial overlay update.
 *
 * `age` accepts a number, null, or the empty string the way the old character
 * PATCH did — a cleared number input sends `""`, and treating that as a
 * validation error would make the field impossible to empty.
 */
export function validateWriterCharacterMetaPatch(
  payload: unknown,
): { patch: WriterCharacterMetaPatch } | { error: string } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'body must be an object' }
  }
  const obj = payload as Record<string, unknown>
  const patch: WriterCharacterMetaPatch = {}

  if ('age' in obj) {
    const raw = obj.age
    if (raw === null || raw === '') {
      patch.age = null
    } else if (typeof raw === 'number' && Number.isInteger(raw)) {
      patch.age = raw
    } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
      patch.age = Number(raw.trim())
    } else {
      return { error: 'age must be an integer, null, or an empty string' }
    }
    if (patch.age !== null && (patch.age < 0 || patch.age > 200)) {
      return { error: 'age must be between 0 and 200' }
    }
  }

  if ('starred' in obj) {
    if (typeof obj.starred !== 'boolean') return { error: 'starred must be a boolean' }
    patch.starred = obj.starred
  }

  for (const field of BOOK_FIELDS) {
    if (!(field in obj)) continue
    const raw = obj[field]
    if (raw === null || raw === '') {
      patch[field] = null
    } else if (typeof raw === 'string') {
      patch[field] = raw
    } else {
      return { error: `${field} must be a book id, null, or an empty string` }
    }
  }

  if (Object.keys(patch).length === 0) {
    // Not an error worth a 400 on its own, but the caller should know it asked
    // for nothing rather than silently "succeeding" at a no-op.
    return { error: 'no recognised fields to update' }
  }

  return { patch }
}
