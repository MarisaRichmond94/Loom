import { defaultBook } from '@/components/sidebar/OutlineTree'

// Which book the sidebar opens on (LOOM-140).
//
// `inProgress` is not a label — it drives the sidebar's default book and its
// scroll target. Collapsing status into three mutually exclusive states means
// marking a book Published CLEARS inProgress, so the old
// `inProgress ?? books[0]` would have quietly sent the sidebar back to book
// one. Invisible while the in-progress book is unpublished; it bites the first
// time a book is published while still being written, which per-book
// publishing makes likely.

const book = (id: string, order: number, over: Partial<{ inProgress: boolean; published: boolean }> = {}) =>
  ({ id, order, inProgress: false, published: false, ...over })

describe('the sidebar opens where the writer is working', () => {
  it('picks the in-progress book, whatever its order', () => {
    const books = [book('a', 1, { published: true }), book('b', 2), book('c', 3, { inProgress: true })]
    expect(defaultBook(books)?.id).toBe('c')
  })

  it('falls back to the FURTHEST-ALONG published book when nothing is in progress', () => {
    // The case the collapse creates: publishing a book clears inProgress, and
    // book one is not where the author was.
    const books = [book('a', 1, { published: true }), book('b', 2, { published: true }), book('c', 3)]
    expect(defaultBook(books)?.id).toBe('b')
  })

  it('falls back to the first book when nothing is published either', () => {
    const books = [book('a', 1), book('b', 2)]
    expect(defaultBook(books)?.id).toBe('a')
  })

  it('handles a series of only published books', () => {
    const books = [book('a', 1, { published: true }), book('b', 2, { published: true })]
    expect(defaultBook(books)?.id).toBe('b')
  })

  it('survives an empty series', () => {
    expect(defaultBook([])).toBeUndefined()
  })

  it('does not depend on array order', () => {
    // Books arrive ordered today; the rule should not rely on it.
    const books = [book('c', 3, { published: true }), book('a', 1, { published: true })]
    expect(defaultBook(books)?.id).toBe('c')
  })
})
