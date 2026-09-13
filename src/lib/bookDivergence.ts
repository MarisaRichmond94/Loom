// Validation for Book.divergesFromBookId — LOOM-152, under LOOM-146.
//
// `divergesFromBookId` is a plain String with no foreign key: adding one to
// Book would mean rebuilding the table the whole manuscript lives in (see the
// schema comment). This module is what an FK would otherwise have enforced.
//
// Every rule here fails SILENTLY if it is allowed through, which is why it is
// checked at the seam rather than left to the UI's book picker. A bad pointer
// does not error anywhere — canonPositionOf simply cannot place the book, and
// the character first/death/last rules quietly fall back to their
// no-information answers. The symptom is a cast list that is subtly wrong in an
// alternate timeline, months later.
//
// Pure, so the rules are testable without a database: the caller does the one
// lookup and passes the row in.

export type DivergenceParent = {
  seriesId: string
  canon: boolean
}

export function validateDivergence(opts: {
  /** The book being edited. */
  bookId: string
  /** The series it belongs to. */
  seriesId: string
  /** The proposed parent's id. */
  divergesFromBookId: string
  /** That parent as loaded, or null when no such book exists. */
  parent: DivergenceParent | null
}): { error: string } | null {
  const { bookId, seriesId, divergesFromBookId, parent } = opts

  if (divergesFromBookId === bookId) {
    return { error: 'A book cannot diverge from itself.' }
  }
  if (!parent || parent.seriesId !== seriesId) {
    return { error: 'A book can only diverge from another book in the same series.' }
  }
  // Branching off another branch would make a book's canon position depend on a
  // CHAIN of divergences. canonPositionOf resolves exactly one hop — an alt book
  // sits half a step after its parent — so a chain would silently resolve to the
  // wrong place rather than failing.
  if (!parent.canon) {
    return { error: 'A book can only diverge from a canon book.' }
  }
  return null
}
