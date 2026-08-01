import { isSafeCharacterId, validateWriterCharacter } from '@/lib/writerCharacters'

// A complete character, shaped like the real ones on disk.
const full = {
  id: 'wc-dcc1107a',
  name: 'Jared Gatlin',
  category: 'main',
  role: null,
  aliases: 'Maknae, Sonja-ya, Jay, Jared Choi',
  traits: [] as string[],
  arc_notes: null,
  goals: null,
  relationships: [{ target: 'Emma Mendoza', nature: 'girlfriend' }],
  books: ["Nobody's Hero", 'Faded'],
  photo_url: '/api/plan/photos/wc-dcc1107a.jpg',
}

describe('validateWriterCharacter', () => {
  it('accepts a complete character', () => {
    expect(validateWriterCharacter(full)).toEqual({ character: full })
  })

  it('rejects a non-object body', () => {
    expect(validateWriterCharacter(null)).toHaveProperty('error')
    expect(validateWriterCharacter([full])).toHaveProperty('error')
  })

  describe('the verbatim-store trap — an absent field is DELETED, not defaulted', () => {
    it.each([
      'id', 'name', 'category', 'role', 'aliases',
      'traits', 'arc_notes', 'goals', 'relationships', 'books', 'photo_url',
    ])('refuses a body missing %s', key => {
      const { [key]: _omitted, ...partial } = full as Record<string, unknown>
      const got = validateWriterCharacter(partial)
      expect(got).toHaveProperty('error')
      // The message names what would have been destroyed — the one chance to
      // explain why an apparently small edit was refused.
      expect((got as { error: string }).error).toContain(key)
    })

    it('names every missing field at once', () => {
      const got = validateWriterCharacter({ id: 'wc-1', name: 'X' }) as { error: string }
      for (const k of ['traits', 'relationships', 'books', 'photo_url']) {
        expect(got.error).toContain(k)
      }
    })
  })

  describe('nullable vs absent', () => {
    // Real characters have nulls all over: 33 of 34 have no role or goals.
    // Refusing null would make them unsaveable.
    it.each(['category', 'role', 'aliases', 'arc_notes', 'goals', 'photo_url'])(
      'accepts %s explicitly null',
      key => {
        expect(validateWriterCharacter({ ...full, [key]: null })).toEqual({
          character: { ...full, [key]: null },
        })
      },
    )

    it('does not accept null for name, or a blank one', () => {
      expect(validateWriterCharacter({ ...full, name: null })).toHaveProperty('error')
      expect(validateWriterCharacter({ ...full, name: '   ' })).toHaveProperty('error')
    })

    it('does not accept null for the list fields', () => {
      expect(validateWriterCharacter({ ...full, traits: null })).toHaveProperty('error')
      expect(validateWriterCharacter({ ...full, relationships: null })).toHaveProperty('error')
      expect(validateWriterCharacter({ ...full, books: null })).toHaveProperty('error')
    })
  })

  describe('shape checking', () => {
    it('rejects malformed relationships', () => {
      expect(validateWriterCharacter({ ...full, relationships: ['Emma'] })).toHaveProperty('error')
      expect(
        validateWriterCharacter({ ...full, relationships: [{ target: 'Emma' }] }),
      ).toHaveProperty('error')
    })

    it('rejects non-string entries in traits or books', () => {
      expect(validateWriterCharacter({ ...full, traits: ['brave', 7] })).toHaveProperty('error')
      expect(validateWriterCharacter({ ...full, books: [{}] })).toHaveProperty('error')
    })

    it('accepts empty lists', () => {
      const bare = { ...full, traits: [], relationships: [], books: [] }
      expect(validateWriterCharacter(bare)).toEqual({ character: bare })
    })
  })
})

describe('isSafeCharacterId', () => {
  it('accepts every id shape actually in the data', () => {
    // Not just wc-<hex>: one real character predates that convention, and
    // pinning the shape would lock it out of photo upload entirely.
    expect(isSafeCharacterId('wc-dcc1107a')).toBe(true)
    expect(isSafeCharacterId('draft-1784764804469')).toBe(true)
  })

  it('rejects anything that could widen a glob or escape the directory', () => {
    for (const bad of ['*', '?', 'wc-*', '[abc]', '../../etc/passwd', 'a/b', 'a.b', '']) {
      expect(isSafeCharacterId(bad)).toBe(false)
    }
  })
})
