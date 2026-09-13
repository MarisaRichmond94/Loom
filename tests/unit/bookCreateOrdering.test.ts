import { readFileSync } from 'fs'
import path from 'path'

// LOOM-156, under LOOM-146. The Add Book flow became a dialog that can set
// canon, a divergence and a gate at creation time — so the POST route now has
// to get right what the PATCH route already does.
//
// Source-level, matching the other route pins in this suite: these are rules
// whose failures are invisible in a response. A colliding order does not error,
// it just makes every ordinal rule over books ambiguous (LOOM-147).

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const postRoute = strip(read('app/api/series/[seriesId]/books/route.ts'))
const modal = read('components/series/BookSettingsModal.tsx')
const layout = read('app/author/[seriesId]/layout.tsx')
const context = read('lib/authorContext.tsx')

describe('POST /books places alt books in their own order range', () => {
  it('gives canon and non-canon books separate ranges', () => {
    expect(postRoute).toContain('ALT_ORDER_BASE')
    // Canon order comes from canon siblings only, so an alt book at 1000 cannot
    // push the next canon book to 1001.
    expect(postRoute).toMatch(/filter\(b => b\.canon\)/)
    expect(postRoute).toMatch(/filter\(b => !b\.canon\)/)
  })

  it('validates a divergence set at creation with the same rules as PATCH', () => {
    // A divergence is exactly as able to be wrong on create as on edit, and
    // every failure mode is silent (see lib/bookDivergence.ts).
    expect(postRoute).toContain('validateDivergence')
  })

  it('refuses to store a divergence on a canon book', () => {
    // A canon book sits at its own order by definition. Accepting one here
    // would create the stale pointer the PATCH clears.
    expect(postRoute).toMatch(/canon \? null :/)
  })

  it('sets in-progress through the exclusive path, not inline', () => {
    // Only one book per series may be in progress; setting it inline would
    // leave two.
    expect(postRoute).toContain('updateMany')
    expect(postRoute).toMatch(/inProgress: false/)
  })
})

describe('the book settings dialog', () => {
  it('offers the condition editor for canon books too', () => {
    // Not an oversight: when a divergence splits the story, the CANON
    // continuation carries the inverse gate. Canon and gated are independent,
    // so the field must not be hidden behind the alt toggle.
    const gate = modal.slice(modal.indexOf('Who reaches this book'))
    expect(gate).toContain('<ConditionRow')
    // The `!canon &&` guard wraps the divergence picker ONLY.
    const divergence = modal.slice(
      modal.indexOf('{!canon && ('),
      modal.indexOf('Who reaches this book'),
    )
    expect(divergence).toContain('Diverges from')
    expect(divergence).not.toContain('<ConditionRow')
  })

  it('reuses the chapter editor’s condition UI rather than a second one', () => {
    // Two condition editors would drift, and the grammar they write is read by
    // one engine.
    expect(modal).toContain("from '@/components/editor/conditionUI'")
  })

  it('leaves genres and keywords alone', () => {
    // They live on Series and books inherit them, so editing them from a dialog
    // titled "Add Book" would silently change every other book in the series.
    //
    // Comments stripped: the file documents this very decision, and matching
    // the explanation instead of the code is a test that fails for being well
    // documented.
    const code = strip(modal)
    expect(code).not.toContain('genres')
    expect(code).not.toContain('keywords')
  })
})

describe('there is only one way to create a book', () => {
  it('the title-only addBook path is gone', () => {
    // It could set a title and nothing else, so an alt book had to be created
    // and then fixed up from separate controls. Leaving it in place would be a
    // second creation path to drift against the dialog.
    expect(layout).not.toContain('async function addBook')
    expect(context).not.toContain('addBook')
  })
})
