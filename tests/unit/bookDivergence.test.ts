import { validateDivergence, type DivergenceParent } from '@/lib/bookDivergence'

// LOOM-152, under LOOM-146. These are the rules a foreign key would have
// enforced if adding one to Book did not mean rebuilding the table the whole
// manuscript lives in.
//
// Every case below fails SILENTLY if allowed through. A bad pointer errors
// nowhere: canonPositionOf simply cannot place the book, and the character
// first/death/last rules fall back to their no-information answers. The symptom
// is a subtly wrong cast list in an alternate timeline, months later — which is
// why these are refused at the seam rather than only in the book picker.

const canonParent: DivergenceParent = { seriesId: 's1', canon: true }

const check = (over: Partial<Parameters<typeof validateDivergence>[0]> = {}) =>
  validateDivergence({
    bookId: 'alt',
    seriesId: 's1',
    divergesFromBookId: 'b3',
    parent: canonParent,
    ...over,
  })

describe('validateDivergence', () => {
  it('accepts a canon book in the same series', () => {
    expect(check()).toBeNull()
  })

  it('refuses a book diverging from itself', () => {
    // canonPositionOf would recurse on itself conceptually — in practice it
    // would place the book half a step after where it already is.
    expect(check({ divergesFromBookId: 'alt' })?.error).toMatch(/itself/)
  })

  it('refuses a parent that does not exist', () => {
    expect(check({ parent: null })?.error).toMatch(/same series/)
  })

  it('refuses a parent in another series', () => {
    expect(check({ parent: { seriesId: 's2', canon: true } })?.error).toMatch(/same series/)
  })

  it('refuses branching off another branch', () => {
    // A chain of divergences would make canon position depend on resolving
    // every hop. canonPositionOf resolves exactly one — an alt book sits half a
    // step after its parent — so a chain resolves to the wrong place rather
    // than failing, which is the worst of both.
    expect(check({ parent: { seriesId: 's1', canon: false } })?.error).toMatch(/canon book/)
  })
})
