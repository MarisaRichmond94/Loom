import {
  resolveWriterCharacter,
  type WriterCharacterSnapshotRow,
  type WriterCharacterMetaRow,
} from '@/lib/resolveWriterCharacter'

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
    book: { id: 'book-2', order: 2 },
    firstBookOrder: null,
    deathBookOrder: null,
    lastBookOrder: null,
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
    expect(resolve({ book: { id: 'b1', order: 1 }, firstBookOrder: 3 })!.visible).toBe(false)
  })

  it('shows them in the first book itself', () => {
    expect(resolve({ book: { id: 'b3', order: 3 }, firstBookOrder: 3 })!.visible).toBe(true)
  })

  it('shows them in later books', () => {
    expect(resolve({ book: { id: 'b5', order: 5 }, firstBookOrder: 3 })!.visible).toBe(true)
  })
})

describe('resolveWriterCharacter — death', () => {
  it('does NOT mark them deceased in the book they die in', () => {
    // The death book shows them normally — tagging it would spoil the death
    // to a reader who has not reached it.
    expect(resolve({ book: { id: 'b3', order: 3 }, deathBookOrder: 3 })!.deceased).toBe(false)
  })

  it('does not mark them deceased in earlier books', () => {
    expect(resolve({ book: { id: 'b2', order: 2 }, deathBookOrder: 3 })!.deceased).toBe(false)
  })

  it('marks them deceased strictly after the death book', () => {
    expect(resolve({ book: { id: 'b4', order: 4 }, deathBookOrder: 3 })!.deceased).toBe(true)
  })

  it('keeps them visible after death — flashbacks still resolve', () => {
    expect(resolve({ book: { id: 'b4', order: 4 }, deathBookOrder: 3 })!.visible).toBe(true)
  })
})

describe('resolveWriterCharacter — last appearance', () => {
  it('does not hide them in their last book', () => {
    expect(resolve({ book: { id: 'b3', order: 3 }, lastBookOrder: 3 })!.hidden).toBe(false)
  })

  it('hides them strictly after it', () => {
    expect(resolve({ book: { id: 'b4', order: 4 }, lastBookOrder: 3 })!.hidden).toBe(true)
  })

  it('is independent of death — fading out does not imply dying', () => {
    const r = resolve({ book: { id: 'b4', order: 4 }, lastBookOrder: 3 })!
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
