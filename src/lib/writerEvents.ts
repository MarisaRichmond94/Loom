// Validation for the WriteAI writer-event proxy (LOOM-32 / LOOM-35).
//
// WriteAI's PATCH /api/writer-events/{id} REPLACES the whole event: every field
// on its WriterEventBody has a default, so a key the client forgets to send is
// silently reset rather than left alone. Editing an event to change its title
// would quietly erase its characters and location, and nothing would report an
// error. This module refuses an incomplete body before it can reach WriteAI.
//
// Same hazard class as PUT /api/sessions/{kind}/{sid}, already guarded in
// src/app/api/writeai/review/session/route.ts and documented in INTEGRATION.md.

export type WriterEventInput = {
  title: string
  date: string | null
  time: string | null
  description: string
  characters: string[]
  location: string | null
}

/**
 * Fields that must be PRESENT on a write, and what counts as valid.
 *
 * The distinction that matters: `date`, `time` and `location` are genuinely
 * nullable in WriteAI — an event with no date is normal. So "absent" and
 * "explicitly null" mean different things here, unlike in the review-session
 * guard where null was always wrong. Absent is the dangerous one: it is
 * indistinguishable from "leave it alone", which is exactly what WriteAI will
 * NOT do. Null is the caller saying "clear it", which is legitimate.
 */
const FIELDS: {
  key: keyof WriterEventInput
  ok: (v: unknown) => boolean
  expected: string
}[] = [
  { key: 'title', ok: v => typeof v === 'string', expected: 'string' },
  { key: 'date', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'time', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'description', ok: v => typeof v === 'string', expected: 'string' },
  {
    key: 'characters',
    ok: v => Array.isArray(v) && v.every(c => typeof c === 'string'),
    expected: 'array of strings',
  },
  { key: 'location', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
]

/**
 * Validate a full event body.
 *
 * Strict on POST as well as PATCH. Creating with a partial body is not
 * destructive — WriteAI just fills in defaults — but Loom's modal always holds
 * every field, so a missing one there means a bug, and one contract is easier
 * to reason about than two.
 *
 * `book_chapters` is deliberately NOT accepted or forwarded. It is the legacy
 * title+positional tagging this epic replaces, removed outright in LOOM-40.
 * Loom never authors it.
 */
export function validateWriterEvent(
  payload: unknown,
): { event: WriterEventInput } | { error: string } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'body must be an object' }
  }
  const obj = payload as Record<string, unknown>

  const missing = FIELDS.filter(f => obj[f.key] === undefined).map(f => f.key)
  if (missing.length) {
    return {
      error:
        'refusing to write an incomplete event — WriteAI replaces the whole object, ' +
        `so this would erase: ${missing.join(', ')}`,
    }
  }

  const wrong = FIELDS.filter(f => !f.ok(obj[f.key]))
  if (wrong.length) {
    const detail = wrong.map(f => `${f.key} must be ${f.expected}`).join('; ')
    return { error: detail }
  }

  return {
    event: {
      title: obj.title as string,
      date: obj.date as string | null,
      time: obj.time as string | null,
      description: obj.description as string,
      characters: obj.characters as string[],
      location: obj.location as string | null,
    },
  }
}
