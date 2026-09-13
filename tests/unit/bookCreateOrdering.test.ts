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
    // so the field must not be conditioned on `canon` at all.
    const gate = modal.slice(modal.indexOf('Who Reaches This Book'))
    expect(gate).toContain('<ConditionRow')
    expect(gate).not.toContain('{!canon')
  })

  it('keeps the divergence picker visible but disabled for a canon book', () => {
    // Disabled rather than hidden: a control that vanishes leaves "where did
    // that go?" unanswered, while a visibly disabled one says a canon book has
    // no divergence. Same treatment as the series page's Publish button.
    const divergence = modal.slice(
      modal.indexOf('Diverges From'),
      modal.indexOf('Who Reaches This Book'),
    )
    expect(divergence).toContain('disabled={canon}')
    expect(modal).not.toContain('{!canon && (')
  })

  it('hands the cover back as a file rather than uploading it itself', () => {
    // The cover endpoint keys the stored filename by book id, and an ADD has
    // no id until the book exists. Uploading from inside the dialog would have
    // nothing to key on.
    expect(modal).toContain('coverFile')
    expect(modal).not.toContain('/cover')
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

// ── The dialog must not submit itself (LOOM-156 bugfix) ──────────────────────
//
// Reported symptom: "when I try to set anything in Who Reaches This Book, the
// modal closes without letting me do anything."
//
// Cause: `conditionUI.tsx` was written for the chapter page, which is NOT a
// <form>. Its buttons carried no explicit `type`, and a <button> inside a form
// defaults to type="submit" — so clicking "add a variable" submitted the dialog
// and it saved and closed. Nothing errored; it looked like the field was
// refusing input.
//
// This is a shared component, so the fix belongs at the source: any future form
// embedding it would hit the same thing.
const conditionUI = readFileSync(
  path.join(__dirname, '../../src/components/editor/conditionUI.tsx'),
  'utf8',
)

describe('conditionUI is safe to embed in a form', () => {
  it('gives every button an explicit type', () => {
    const withoutType = (conditionUI.match(/<button\b(?![^>]*\btype=)/g) ?? []).length
    expect(withoutType).toBe(0)
  })

  it('has at least one button, so the check above is not vacuous', () => {
    expect((conditionUI.match(/<button\b/g) ?? []).length).toBeGreaterThan(0)
  })

  it('swallows Enter in the variable search whether or not it matches', () => {
    // The old guard only called preventDefault when there WAS a match, so
    // searching for a variable that did not exist fell through to the form's
    // implicit submission.
    const handler = conditionUI.slice(
      conditionUI.indexOf("if (e.key === 'Enter'"),
      conditionUI.indexOf('placeholder="Search variables…"'),
    )
    expect(handler).toContain('e.preventDefault()')
    expect(handler.indexOf('e.preventDefault()'))
      .toBeLessThan(handler.indexOf('filtered.length > 0'))
  })
})

describe('the dialog contains Enter inside the condition editor', () => {
  it('prevents Enter from reaching the form', () => {
    // ValueSetter's input has no key handling of its own, so typing a condition
    // value and pressing Enter would otherwise submit the dialog mid-edit.
    const section = modal.slice(modal.indexOf('Who Reaches This Book'))
    expect(section).toContain("if (e.key === 'Enter') e.preventDefault()")
  })
})
