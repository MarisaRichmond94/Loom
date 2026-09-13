import {
  resolveWriterCharacter,
  canonPositionOf,
  pointerApplies,
  type BookPosition,
  type WriterCharacterSnapshotRow,
  type WriterCharacterMetaRow,
} from '@/lib/resolveWriterCharacter'

/** A canon book at its place in the series. */
const canonBook = (id: string, order: number): BookPosition =>
  ({ id, order, canon: true, divergesFromOrder: null })

/**
 * A non-canon book. `order` sorts it beneath every canon book (which is why it
 * cannot be compared directly); `divergesFromOrder` is where it actually
 * happens.
 */
const altBook = (id: string, order: number, divergesFromOrder: number | null): BookPosition =>
  ({ id, order, canon: false, divergesFromOrder })

// resolveCharacter.ts — the model this replaces — shipped with no unit tests
// at all, so this is a fresh suite rather than a port. The book-order rules it
// covers are the ones the reader's cast list depends on, and every one of them
// is an off-by-one waiting to happen: "deceased" and "hidden" are STRICTLY
// after their book, "visible" is at-or-after.

const snapshot = (over: Partial<WriterCharacterSnapshotRow> = {}): WriterCharacterSnapshotRow => ({
  writerCharacterId: 'wc-abc12345',
  name: 'Jared Gatlin',
  category: 'main',
  role: null,
  aliases: 'Maknae, Jay',
  photoUrl: '/api/plan/photos/wc-abc12345.jpg',
  ...over,
})

const meta = (over: Partial<WriterCharacterMetaRow> = {}): WriterCharacterMetaRow => ({
  age: 15,
  starred: false,
  firstBookId: null,
  deathBookId: null,
  lastBookId: null,
  ...over,
})

const resolve = (opts: Partial<Parameters<typeof resolveWriterCharacter>[0]> = {}) =>
  resolveWriterCharacter({
    snapshot: snapshot(),
    meta: meta(),
    bookMeta: null,
    book: canonBook('book-2', 2),
    firstBook: null,
    deathBook: null,
    lastBook: null,
    avatarFiles: new Set<string>(),
    ...opts,
  })

describe('resolveWriterCharacter — identity comes from WriteAI', () => {
  it('takes name, category, role and aliases from the snapshot', () => {
    const r = resolve()!
    expect(r.id).toBe('wc-abc12345')
    expect(r.name).toBe('Jared Gatlin')
    expect(r.category).toBe('main')
    expect(r.aliases).toBe('Maknae, Jay')
  })

  it('returns null when WriteAI has no such character', () => {
    // A meta row or prose mark pointing at a deleted character. Callers skip
    // it; a reader page must not throw over a missing cache row.
    expect(resolve({ snapshot: null })).toBeNull()
  })
})

describe('resolveWriterCharacter — book state comes from Loom', () => {
  it('uses the per-book age over the series age, and flags the override', () => {
    const r = resolve({ meta: meta({ age: 15 }), bookMeta: { age: 17 } })!
    expect(r.age).toBe(17)
    expect(r.hasOverride).toBe(true)
  })

  it('falls back to the series age when the book has no override', () => {
    const r = resolve({ meta: meta({ age: 15 }), bookMeta: null })!
    expect(r.age).toBe(15)
    expect(r.hasOverride).toBe(false)
  })

  it('falls back to the series age when the override row exists but its age is null', () => {
    // Parity with resolveCharacter.ts:83 (`override?.age ?? character.age`),
    // and NOT an accident: 8 real CharacterBookOverride rows carry a null age
    // today, and all 8 currently display the series age. Reading null as
    // "deliberately unstated" would silently blank the age on 8 cast cards.
    //
    // The row still counts as an override, so the UI's "reset to series
    // default" affordance stays meaningful.
    const r = resolve({ meta: meta({ age: 15 }), bookMeta: { age: null } })!
    expect(r.age).toBe(15)
    expect(r.hasOverride).toBe(true)
  })

  it('shows a character Loom knows nothing about, rather than hiding them', () => {
    const r = resolve({ meta: null })!
    expect(r.visible).toBe(true)
    expect(r.age).toBeNull()
    expect(r.starred).toBe(false)
    expect(r.deceased).toBe(false)
    expect(r.hidden).toBe(false)
  })
})

describe('resolveWriterCharacter — first appearance', () => {
  it('hides the character in books before their first', () => {
    expect(resolve({ book: canonBook('b1', 1), firstBook: canonBook('first-book', 3) })!.visible).toBe(false)
  })

  it('shows them in the first book itself', () => {
    expect(resolve({ book: canonBook('b3', 3), firstBook: canonBook('first-book', 3) })!.visible).toBe(true)
  })

  it('shows them in later books', () => {
    expect(resolve({ book: canonBook('b5', 5), firstBook: canonBook('first-book', 3) })!.visible).toBe(true)
  })
})

describe('resolveWriterCharacter — death', () => {
  it('does NOT mark them deceased in the book they die in', () => {
    // The death book shows them normally — tagging it would spoil the death
    // to a reader who has not reached it.
    expect(resolve({ book: canonBook('b3', 3), deathBook: canonBook('death-book', 3) })!.deceased).toBe(false)
  })

  it('does not mark them deceased in earlier books', () => {
    expect(resolve({ book: canonBook('b2', 2), deathBook: canonBook('death-book', 3) })!.deceased).toBe(false)
  })

  it('marks them deceased strictly after the death book', () => {
    expect(resolve({ book: canonBook('b4', 4), deathBook: canonBook('death-book', 3) })!.deceased).toBe(true)
  })

  it('keeps them visible after death — flashbacks still resolve', () => {
    expect(resolve({ book: canonBook('b4', 4), deathBook: canonBook('death-book', 3) })!.visible).toBe(true)
  })
})

describe('resolveWriterCharacter — last appearance', () => {
  it('does not hide them in their last book', () => {
    expect(resolve({ book: canonBook('b3', 3), lastBook: canonBook('last-book', 3) })!.hidden).toBe(false)
  })

  it('hides them strictly after it', () => {
    expect(resolve({ book: canonBook('b4', 4), lastBook: canonBook('last-book', 3) })!.hidden).toBe(true)
  })

  it('is independent of death — fading out does not imply dying', () => {
    const r = resolve({ book: canonBook('b4', 4), lastBook: canonBook('last-book', 3) })!
    expect(r.hidden).toBe(true)
    expect(r.deceased).toBe(false)
  })
})

describe('resolveWriterCharacter — portraits', () => {
  it('prefers a book-specific file and reports both flags', () => {
    const files = new Set(['wc-abc12345.jpg', 'wc-abc12345-book-2.jpg'])
    const r = resolve({ avatarFiles: files })!
    expect(r.hasBookAvatar).toBe(true)
    expect(r.hasCanonicalAvatar).toBe(true)
    expect(r.hasAvatar).toBe(true)
  })

  it('does not treat another book\'s portrait as this book\'s', () => {
    const r = resolve({ avatarFiles: new Set(['wc-abc12345-book-9.jpg']) })!
    expect(r.hasBookAvatar).toBe(false)
    expect(r.hasCanonicalAvatar).toBe(false)
    expect(r.hasAvatar).toBe(false)
  })

  it('still offers WriteAI\'s portrait when Loom holds no file', () => {
    const r = resolve({ avatarFiles: new Set<string>() })!
    expect(r.hasAvatar).toBe(false)
    expect(r.writerPhotoUrl).toBe('/api/plan/photos/wc-abc12345.jpg')
  })

  it('handles a character with no portrait anywhere', () => {
    const r = resolve({ snapshot: snapshot({ photoUrl: null }) })!
    expect(r.hasAvatar).toBe(false)
    expect(r.writerPhotoUrl).toBeNull()
  })
})

// ── LOOM-147: ordinal rules across a non-canon branch ────────────────────────
//
// Book.order is a total order over the series, but a STORY order only along one
// line. An alt book sorts beneath every canon book, so comparing its raw order
// against a canon pointer is meaningless — and silently wrong in the dangerous
// direction: before this, a death in an alternate timeline marked the character
// deceased in every canon book that sorted before it.
//
// The fixture throughout: canon books 1-5, and an alt book branching off book 3
// (so it happens at 3.5) that sorts at order 6.

describe('canonPositionOf', () => {
  it('places a canon book at its own order', () => {
    expect(canonPositionOf(canonBook('b3', 3))).toBe(3)
  })

  it('places an alt book immediately after the book it branches off', () => {
    // NOT at its raw order of 6, which would put it after canon book 5.
    expect(canonPositionOf(altBook('alt', 6, 3))).toBe(3.5)
  })

  it('cannot place an alt book whose divergence is unrecorded', () => {
    expect(canonPositionOf(altBook('alt', 6, null))).toBeNull()
  })
})

describe('pointerApplies', () => {
  it('lets a canon pointer speak about any book', () => {
    expect(pointerApplies(canonBook('b3', 3), altBook('alt', 6, 3))).toBe(true)
  })

  it('confines a non-canon pointer to its own book', () => {
    const alt = altBook('alt', 6, 3)
    expect(pointerApplies(alt, alt)).toBe(true)
    expect(pointerApplies(alt, canonBook('b5', 5))).toBe(false)
  })
})

describe('resolveWriterCharacter — deaths do not cross branches', () => {
  it('THE BUG: a death in the alt book does not reach canon books after it', () => {
    // Verified to FAIL against the pre-LOOM-147 rule, which read `9 > 6` and
    // said deceased. This is the alternate timeline leaking into canon.
    const r = resolve({
      book: canonBook('b9', 9),
      deathBook: altBook('alt', 6, 3),
    })!
    expect(r.deceased).toBe(false)
  })

  it('nor canon books that merely sort before it', () => {
    // Passes under the old rule too (`5 > 6` is false), so it is a guard rather
    // than a regression test — it pins the answer as coming from the canon
    // filter rather than from the accident that alt books sort last.
    const r = resolve({
      book: canonBook('b5', 5),
      deathBook: altBook('alt', 6, 3),
    })!
    expect(r.deceased).toBe(false)
  })

  it('still shows them normally in the alt book they die in', () => {
    const alt = altBook('alt', 6, 3)
    const r = resolve({ book: alt, deathBook: alt })!
    expect(r.deceased).toBe(false)
    expect(r.visible).toBe(true)
  })
})

describe('resolveWriterCharacter — canon deaths reach the alt branch', () => {
  it('marks them deceased in the alt book when they died before the divergence', () => {
    // Died in book 3; the alt book branches off book 3, so it happens after.
    const r = resolve({
      book: altBook('alt', 6, 3),
      deathBook: canonBook('b3', 3),
    })!
    expect(r.deceased).toBe(true)
  })

  it('does NOT mark them deceased in the alt book for a death on the canon branch', () => {
    // Died in canon book 4 — a book the alt branch never reaches. That death
    // did not happen here. Also verified to FAIL against the old rule, which
    // read `6 > 4` and said deceased.
    const r = resolve({
      book: altBook('alt', 6, 3),
      deathBook: canonBook('b4', 4),
    })!
    expect(r.deceased).toBe(false)
  })
})

describe('resolveWriterCharacter — first and last appearance across branches', () => {
  it('shows a character in the alt book when they first appeared before the divergence', () => {
    const r = resolve({
      book: altBook('alt', 6, 3),
      firstBook: canonBook('b2', 2),
    })!
    expect(r.visible).toBe(true)
  })

  it('hides a character in the alt book when they first appear only on the canon branch', () => {
    const r = resolve({
      book: altBook('alt', 6, 3),
      firstBook: canonBook('b4', 4),
    })!
    expect(r.visible).toBe(false)
  })

  it('does not hide a canon-book character because they fade out in the alt branch', () => {
    const r = resolve({
      book: canonBook('b5', 5),
      lastBook: altBook('alt', 6, 3),
    })!
    expect(r.hidden).toBe(false)
  })
})

describe('resolveWriterCharacter — an alt book with no recorded divergence', () => {
  // Nothing is knowable about where such a book sits, so every rule falls back
  // to its no-information answer. Under-reporting on purpose: a character shown
  // who should be hidden is a cosmetic miss in the author's own grid, while a
  // living character marked dead is the alternate timeline leaking into canon.
  const orphan = altBook('alt', 6, null)

  it('never marks anyone deceased', () => {
    expect(resolve({ book: orphan, deathBook: canonBook('b1', 1) })!.deceased).toBe(false)
  })

  it('never hides anyone', () => {
    expect(resolve({ book: orphan, lastBook: canonBook('b1', 1) })!.hidden).toBe(false)
    expect(resolve({ book: orphan, firstBook: canonBook('b9', 9) })!.visible).toBe(true)
  })
})
