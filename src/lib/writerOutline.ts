// Validation for the WriteAI plan-outline proxy (LOOM-95).
//
// ⚠️ PUT /api/plan/outline/{book} REPLACES THE WHOLE CHAPTER LIST.
//
//   outlines[key] = body.chapters
//
// No merge, no per-card endpoint. Every field edit is therefore a
// read-modify-write of the entire book's outline, and anything missing from the
// body is deleted with a 200 and nothing to see. Same hazard class as the
// writer-event PATCH (src/lib/writerEvents.ts) and the review-session PUT, and
// worse in degree: those lose one object's fields, this loses a book's planning.
//
// The store is hand-authored and there is no undo, so this module refuses a
// malformed list before it can reach an endpoint that overwrites everything.

/** One outline card, exactly as WriteAI stores it. */
export type OutlineCard = {
  id: string
  book: number | string
  /** The manuscript's chapter number, or null for a card with no prose yet. */
  chapter: number | null
  position: number
  status: 'planned' | 'synced'
  heading: string
  pov: string
  date: string | null
  /**
   * ⚠️ HTML, not plain text — `<p>…</p>` with entity-escaped content. Verified
   * against the live store, where all 30 cards of book 1 carry markup. An
   * editor that writes plain text here does not merely look different; it
   * silently strips every paragraph break the writer already has.
   */
  writer_summary: string
  /** WriteAI's extraction for a synced chapter. Loom never authors these — but
   *  it must send back exactly what it received, or they are erased. */
  extracted_bullets: string[]
  notes: string | null

  // ── Fields Loom never edits and must never drop ──────────────────────────
  //
  // Neither appears in WriteAI's OutlineChapter type, and both are load-bearing.
  // They are listed here so a client building a card from this type carries
  // them; the validator preserves whatever it is given verbatim, so they also
  // survive on their own.

  /**
   * The chapter's Loom cuid — the stable identity LOOM-65 introduced.
   *
   * `_auto_reconcile` keys cards by this (`by_loom = {c["loom_id"]: c …}`), so a
   * card that loses it falls back to matching by chapter NUMBER, which is
   * exactly the positional matching the cuid exists to replace. Absent on a
   * freshly added planned card, which has no chapter behind it yet.
   */
  loom_id?: string | null

  /**
   * The machine-written summary that `writer_summary` was last compared against.
   *
   * WriteAI clears and refreshes a summary only when the writer's copy still
   * matches this exactly — that is how it tells "untouched machine text" from
   * "the writer wrote this". Drop it and a hand-edited summary becomes
   * indistinguishable from a generated one.
   */
  summary_source?: string | null
}

const FIELDS: {
  key: keyof OutlineCard
  ok: (v: unknown) => boolean
  expected: string
}[] = [
  { key: 'id', ok: v => typeof v === 'string' && v.length > 0, expected: 'non-empty string' },
  { key: 'book', ok: v => typeof v === 'number' || typeof v === 'string', expected: 'number or string' },
  { key: 'chapter', ok: v => v === null || typeof v === 'number', expected: 'number or null' },
  { key: 'position', ok: v => typeof v === 'number' && Number.isFinite(v), expected: 'finite number' },
  {
    key: 'status',
    ok: v => v === 'planned' || v === 'synced',
    expected: '"planned" or "synced"',
  },
  { key: 'heading', ok: v => typeof v === 'string', expected: 'string' },
  { key: 'pov', ok: v => typeof v === 'string', expected: 'string' },
  { key: 'date', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'writer_summary', ok: v => typeof v === 'string', expected: 'string' },
  {
    key: 'extracted_bullets',
    ok: v => Array.isArray(v) && v.every(b => typeof b === 'string'),
    expected: 'array of strings',
  },
  { key: 'notes', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
]

/**
 * Fields checked only when present.
 *
 * Not required, because a card just created through POST genuinely has neither
 * — WriteAI's `add_chapter` seeds a planned card without them. Requiring them
 * would reject the first legitimate save after adding a card.
 *
 * Type-checked when they ARE present, so a client cannot turn a cuid into a
 * number on its way through.
 */
const OPTIONAL_FIELDS: {
  key: 'loom_id' | 'summary_source'
  ok: (v: unknown) => boolean
  expected: string
}[] = [
  { key: 'loom_id', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
  { key: 'summary_source', ok: v => v === null || typeof v === 'string', expected: 'string or null' },
]

/**
 * Validate a whole outline list on its way to WriteAI.
 *
 * Every card must carry every field. A card that arrives without
 * `extracted_bullets` is not "leave them alone" — it is "delete them", and the
 * client that dropped them is usually a form that only knew about the fields it
 * rendered. `chapter` and `status` matter for the same reason and one more: the
 * backend re-derives a written chapter's number from Loom's manifest, so a card
 * that loses its `chapter` loses its link to the manuscript.
 *
 * An EMPTY list is refused unless `allowEmpty`. Emptying an outline is done one
 * card at a time through the DELETE endpoint; a PUT of `[]` is overwhelmingly a
 * client that failed to load and saved anyway, which is precisely the shape of
 * the accident this guard exists for.
 *
 * What this deliberately does NOT do is compare the list against what WriteAI
 * currently holds. That would need a GET first — which seeds and saves as a side
 * effect — and it would reject legitimate writes whenever WriteAI's own pane had
 * added a card, fighting the last-write-wins model that was accepted
 * deliberately. Shape is what prevents silent field loss; count is not.
 */
export function validateOutlineCards(
  payload: unknown,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): { cards: OutlineCard[] } | { error: string } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'body must be an object' }
  }
  const { chapters } = payload as { chapters?: unknown }
  if (!Array.isArray(chapters)) return { error: 'chapters must be an array' }

  if (chapters.length === 0 && !allowEmpty) {
    return {
      error:
        'refusing to write an empty outline — this PUT replaces the whole list, ' +
        'so it would delete every card for the book. Delete cards individually, ' +
        'or pass allowEmpty if this is really what you mean.',
    }
  }

  for (const [i, card] of chapters.entries()) {
    if (card === null || typeof card !== 'object' || Array.isArray(card)) {
      return { error: `chapters[${i}] must be an object` }
    }
    const obj = card as Record<string, unknown>

    const missing = FIELDS.filter(f => obj[f.key] === undefined).map(f => f.key)
    if (missing.length) {
      return {
        error:
          `refusing to write an incomplete card (chapters[${i}], id ${String(obj.id)}) — ` +
          `WriteAI replaces the whole outline, so this would erase: ${missing.join(', ')}`,
      }
    }

    const wrong = [
      ...FIELDS.filter(f => !f.ok(obj[f.key])),
      ...OPTIONAL_FIELDS.filter(f => obj[f.key] !== undefined && !f.ok(obj[f.key])),
    ]
    if (wrong.length) {
      const detail = wrong.map(f => `${f.key} must be ${f.expected}`).join('; ')
      return { error: `chapters[${i}]: ${detail}` }
    }
  }

  // Two cards sharing an id makes DELETE ambiguous and reorder unstable — and
  // it is a symptom of a client that duplicated rather than moved.
  const ids = chapters.map(c => (c as OutlineCard).id)
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
  if (duplicate !== undefined) {
    return { error: `duplicate card id: ${duplicate}` }
  }

  // Returned VERBATIM — the same objects that came in, not a reconstruction
  // from the fields above. That is deliberate: WriteAI's cards carry keys this
  // module does not know about (`loom_id` and `summary_source` were two of
  // them, found only by reading the live store), and rebuilding the card from a
  // known-field list is precisely how those get dropped. Validate what you
  // understand; forward what you do not.
  return { cards: chapters as OutlineCard[] }
}

/**
 * A card id safe to interpolate into a WriteAI path.
 *
 * Ids are WriteAI's own (`plan-<hex>` for planned cards, canon-derived for
 * synced ones), so this is a shape check rather than a parser: reject anything
 * carrying a path separator or a traversal, and let encodeURIComponent handle
 * the rest. The DELETE endpoint behind this takes the id straight into a lookup
 * — cheap to guard here, and the photo-glob incident (LOOM-43) is what an
 * unvalidated id reaching a filesystem-adjacent path costs.
 */
export function isSafeOutlineCardId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id)
}
