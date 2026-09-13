import { readFileSync } from 'fs'
import path from 'path'
import {
  buildLocalOutline,
  nextPlaceholderPosition,
  isPlaceholderCardId,
  PLACEHOLDER_PREFIX,
  type LocalChapterRow,
  type LocalPlaceholderRow,
} from '@/lib/localOutline'
import { isSafeOutlineCardId } from '@/lib/writerOutline'
import { outlineCardLabels } from '@/lib/outlineCards'

// LOOM-153, under LOOM-146. A non-canon book is never ingested by WriteAI, so
// `plan_outline.json` has nowhere to hold its outline and WriteAI must not be
// made to. Chapter-backed cards are DERIVED from the chapters; only a card with
// no chapter behind it is stored.

const ch = (over: Partial<LocalChapterRow> & { id: string; order: number }): LocalChapterRow => ({
  title: `Chapter ${over.order}`, pov: null, date: null, numbered: true, summary: null, ...over,
})

const ph = (over: Partial<LocalPlaceholderRow> & { id: string; position: number }): LocalPlaceholderRow => ({
  heading: 'Planned', pov: '', date: null, summary: '', notes: null, ...over,
})

describe('buildLocalOutline', () => {
  it('derives one card per chapter, in order', () => {
    const cards = buildLocalOutline([ch({ id: 'c2', order: 2 }), ch({ id: 'c1', order: 1 })], [])
    expect(cards.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(cards.map(c => c.position)).toEqual([1, 2])
  })

  it('takes the summary from ChapterSummary, and is empty without one', () => {
    // ChapterSummary is the table LOOM-120 added for "a chapter WriteAI cannot
    // describe" — an alt book's chapters are that case, generalised.
    const cards = buildLocalOutline([
      ch({ id: 'c1', order: 1, summary: { body: 'She turns back.' } }),
      ch({ id: 'c2', order: 2 }),
    ], [])
    expect(cards[0].writer_summary).toBe('She turns back.')
    expect(cards[1].writer_summary).toBe('')
  })

  it('carries loom_id on chapter cards and not on placeholders', () => {
    const cards = buildLocalOutline([ch({ id: 'c1', order: 1 })], [ph({ id: 'p1', position: 1.5 })])
    expect(cards[0].loom_id).toBe('c1')
    expect(cards[1].loom_id).toBeNull()
  })

  it('never invents extracted_bullets — there is no extraction on this path', () => {
    const cards = buildLocalOutline([ch({ id: 'c1', order: 1 })], [])
    expect(cards[0].extracted_bullets).toEqual([])
  })

  it('does not count an unnumbered chapter toward the chapter number', () => {
    // Same rule as the canon walk: a prologue is 0 and does not consume 1.
    const cards = buildLocalOutline([
      ch({ id: 'c0', order: 1, title: 'Prologue', numbered: false }),
      ch({ id: 'c1', order: 2 }),
      ch({ id: 'c2', order: 3 }),
    ], [])
    expect(cards.map(c => c.chapter)).toEqual([0, 1, 2])
    // And the shared label helper renders it the way the canon board does.
    expect(outlineCardLabels(cards)).toEqual(['Prologue', 'Chapter 1', 'Chapter 2'])
  })

  it('sorts a placeholder in among the chapters without renumbering them', () => {
    // The reason positions are fractional: inserting a plan between chapters 1
    // and 2 must not touch a single chapter row.
    const cards = buildLocalOutline(
      [ch({ id: 'c1', order: 1 }), ch({ id: 'c2', order: 2 })],
      [ph({ id: 'p1', position: 1.5, heading: 'The confrontation' })],
    )
    expect(cards.map(c => c.id)).toEqual(['c1', `${PLACEHOLDER_PREFIX}p1`, 'c2'])
    expect(cards[0].position).toBe(1)
    expect(cards[2].position).toBe(2)
  })

  it('marks chapter cards synced and placeholders planned', () => {
    const cards = buildLocalOutline([ch({ id: 'c1', order: 1 })], [ph({ id: 'p1', position: 2 })])
    expect(cards[0].status).toBe('synced')
    expect(cards[1].status).toBe('planned')
  })
})

describe('placeholder card ids', () => {
  it('pass the existing card-id guard', () => {
    // The guard allows only [A-Za-z0-9._-]. Fitting it beats widening it — the
    // photo-glob incident (LOOM-43) is what an unvalidated id costs.
    expect(isSafeOutlineCardId(`${PLACEHOLDER_PREFIX}clx1234abcd`)).toBe(true)
  })

  it('cannot be confused with a chapter cuid', () => {
    expect(isPlaceholderCardId('clx1234abcd')).toBe(false)
    expect(isPlaceholderCardId(`${PLACEHOLDER_PREFIX}clx1234abcd`)).toBe(true)
  })
})

describe('nextPlaceholderPosition', () => {
  it('lands halfway to the next occupied position', () => {
    expect(nextPlaceholderPosition(1, [1, 2, 3])).toBe(1.5)
  })

  it('keeps repeated inserts at the same spot in order', () => {
    // Two "add after chapter 1" in a row must not collide on 1.5.
    const first = nextPlaceholderPosition(1, [1, 2])
    const second = nextPlaceholderPosition(1, [1, 2, first])
    expect(second).toBeLessThan(first)
    expect(second).toBeGreaterThan(1)
  })

  it('takes a whole step when nothing follows', () => {
    expect(nextPlaceholderPosition(3, [1, 2, 3])).toBe(4)
  })
})

// ── The routing decision, pinned at source level ─────────────────────────────
//
// Invisible from a response if it regresses: the Outline tab would simply show
// the "not in WriteAI" empty state for an alt book, which looks like a state
// rather than a bug.
const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')
const outlineRoute = read('app/api/writeai/outline/route.ts')
const chapterRoute = read('app/api/writeai/outline/chapter/route.ts')
const localModule = read('app/api/writeai/outline/local.ts')

describe('the outline endpoints dispatch non-canon books locally', () => {
  it('checks the canon flag before resolving a WriteAI book number', () => {
    for (const src of [outlineRoute, chapterRoute]) {
      expect(src).toContain('localBookId')
      expect(src.indexOf('localBookId(req)')).toBeLessThan(src.indexOf('bookNumber(req)'))
    }
  })

  it('never calls WriteAI on the local path', () => {
    expect(localModule).not.toContain('callWriteAi')
    expect(localModule).not.toContain('resolveWriteaiBook')
  })

  it('does not run the whole-list validator on the local path', () => {
    // validateOutlineCards enforces completeness because WriteAI's PUT deletes
    // any field missing from the body. Nothing local does, so applying it would
    // reject legitimate partial edits for missing fields with no local meaning.
    //
    // Comments are stripped first — the branch carries a note explaining this
    // very rule, and matching prose instead of code is a test that fails for
    // being well documented. Same `strip` shape readerGate.test.ts uses.
    const strip = (x: string) =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const put = outlineRoute.indexOf('export async function PUT')
    const localBranch = strip(
      outlineRoute.slice(put, outlineRoute.indexOf('const book = await bookNumber(req)', put)),
    )
    expect(localBranch).not.toContain('validateOutlineCards')
    // Not vacuous: the canon path below it does run the validator.
    expect(strip(outlineRoute.slice(put))).toContain('validateOutlineCards')
  })

  it('refuses to delete a chapter-backed card', () => {
    // The card IS the chapter. A planning board must not delete prose.
    expect(localModule).toContain('isPlaceholderCardId')
    expect(localModule).toMatch(/status: 409/)
  })
})
