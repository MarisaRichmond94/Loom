import { validateOutlineCards, isSafeOutlineCardId } from '@/lib/writerOutline'

// The whole-list PUT guard (LOOM-95).
//
// PUT /api/plan/outline/{book} does `outlines[key] = body.chapters` — no merge,
// no per-card endpoint. Anything missing from the body is deleted with a 200 and
// nothing in the response to say so, over a store that is hand-authored and has
// no undo. These tests pin the refusals that stand between a buggy client and a
// book's planning.

const card = (over: Record<string, unknown> = {}) => ({
  id: 'ch-1-1',
  book: 1,
  chapter: 1,
  position: 1,
  status: 'synced',
  heading: 'Chapter 1',
  pov: 'Jared Gatlin',
  date: 'Saturday, October 31st',
  writer_summary: '<p>Something happens.</p>',
  extracted_bullets: ['a thing happened'],
  notes: null,
  loom_id: 'cmp8wtcrh0003zufx6ve7a503',
  summary_source: '<p>Something happens.</p>',
  ...over,
})

describe('validateOutlineCards refuses destructive writes', () => {
  it('accepts a complete list', () => {
    const result = validateOutlineCards({ chapters: [card()] })
    expect('cards' in result && result.cards).toHaveLength(1)
  })

  // The core guard. A form that only knows the fields it renders submits
  // exactly this, and every bullet in the book vanishes.
  it.each([
    'extracted_bullets',
    'chapter',
    'status',
    'id',
    'position',
    'writer_summary',
    'notes',
    'date',
    'pov',
    'heading',
  ])('refuses a card missing %s', field => {
    const partial = card()
    delete (partial as Record<string, unknown>)[field]
    const result = validateOutlineCards({ chapters: [partial] })
    expect('error' in result && result.error).toContain(field)
  })

  // An empty PUT is almost always a client that failed to load and saved
  // anyway — the exact accident the guard exists for.
  it('refuses an empty list by default', () => {
    const result = validateOutlineCards({ chapters: [] })
    expect('error' in result && result.error).toMatch(/empty outline/)
  })

  it('allows an empty list only when asked explicitly', () => {
    const result = validateOutlineCards({ chapters: [] }, { allowEmpty: true })
    expect('cards' in result && result.cards).toEqual([])
  })

  it('refuses duplicate ids', () => {
    const result = validateOutlineCards({ chapters: [card(), card()] })
    expect('error' in result && result.error).toMatch(/duplicate/)
  })

  it.each([
    ['status', 'archived'],
    ['chapter', 'one'],
    ['position', Number.NaN],
    ['extracted_bullets', 'a thing happened'],
    ['loom_id', 42],
    ['summary_source', 0],
  ])('refuses a bad %s', (field, value) => {
    const result = validateOutlineCards({ chapters: [card({ [field]: value })] })
    expect('error' in result && result.error).toContain(field)
  })
})

// loom_id and summary_source appear in neither WriteAI's OutlineChapter type nor
// its API docs — they were found by reading the live store. loom_id is the cuid
// auto-reconcile keys cards by (LOOM-65), and summary_source is how WriteAI
// tells a hand-edited summary from a generated one. Dropping either is silent
// and permanent.
describe('unknown and load-bearing fields survive', () => {
  it('passes cards through verbatim rather than rebuilding them', () => {
    const withExtras = card({ some_future_field: 'keep me', loom_id: 'cmpXYZ' })
    const result = validateOutlineCards({ chapters: [withExtras] })
    expect('cards' in result && result.cards[0]).toEqual(withExtras)
  })

  it('accepts a freshly added planned card, which has neither', () => {
    const planned = card({ status: 'planned', chapter: null, id: 'plan-186fb0a0' })
    delete (planned as Record<string, unknown>).loom_id
    delete (planned as Record<string, unknown>).summary_source
    expect('cards' in validateOutlineCards({ chapters: [planned] })).toBe(true)
  })
})

// The id goes straight into a WriteAI path. Cheap to guard, and LOOM-43 is what
// an unvalidated id reaching a filesystem-adjacent endpoint costs.
describe('isSafeOutlineCardId', () => {
  it.each(['plan-186fb0a0', 'ch-1-1', 'ch-2-47'])('accepts %s', id => {
    expect(isSafeOutlineCardId(id)).toBe(true)
  })

  it.each(['../../etc/passwd', 'a/b', '*', '', null, undefined, 42, 'a'.repeat(129)])(
    'rejects %p',
    id => {
      expect(isSafeOutlineCardId(id)).toBe(false)
    },
  )
})
