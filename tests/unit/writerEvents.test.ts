import { validateWriterEvent } from '@/lib/writerEvents'

// A complete, valid event — the shape Loom's modal always holds.
const full = {
  title: 'Emma has a miscarriage',
  date: 'Monday, May 10th, 2010',
  time: '20:00',
  description: 'Off-page.',
  characters: ['Emma', 'Jared Gatlin'],
  location: 'Hospital',
}

describe('validateWriterEvent', () => {
  it('accepts a complete event and returns only the fields WriteAI stores', () => {
    const got = validateWriterEvent(full)
    expect(got).toEqual({ event: full })
  })

  it('rejects a non-object body', () => {
    expect(validateWriterEvent(null)).toHaveProperty('error')
    expect(validateWriterEvent('nope')).toHaveProperty('error')
    expect(validateWriterEvent([full])).toHaveProperty('error')
  })

  describe('the PATCH footgun — absent fields would be silently erased', () => {
    it.each(['title', 'date', 'time', 'description', 'characters', 'location'])(
      'refuses a body missing %s',
      key => {
        const { [key]: _omitted, ...partial } = full as Record<string, unknown>
        const got = validateWriterEvent(partial)
        expect(got).toHaveProperty('error')
        // The message must name what would have been destroyed — this is the
        // one chance to tell a caller why their "small edit" was refused.
        expect((got as { error: string }).error).toContain(key)
      },
    )

    it('names every missing field at once, not just the first', () => {
      const got = validateWriterEvent({ title: 'x' }) as { error: string }
      for (const k of ['date', 'time', 'description', 'characters', 'location']) {
        expect(got.error).toContain(k)
      }
    })
  })

  describe('nullable vs absent — the distinction that matters here', () => {
    // date/time/location are genuinely nullable in WriteAI: an event with no
    // date is normal. Only ABSENCE is dangerous, because absence is what
    // WriteAI turns into a silent reset.
    it.each(['date', 'time', 'location'])('accepts %s explicitly null', key => {
      expect(validateWriterEvent({ ...full, [key]: null })).toEqual({
        event: { ...full, [key]: null },
      })
    })

    it('accepts an event with no date, time or location at all', () => {
      const bare = { ...full, date: null, time: null, location: null }
      expect(validateWriterEvent(bare)).toEqual({ event: bare })
    })

    it('does NOT accept null for the non-nullable fields', () => {
      expect(validateWriterEvent({ ...full, title: null })).toHaveProperty('error')
      expect(validateWriterEvent({ ...full, description: null })).toHaveProperty('error')
      expect(validateWriterEvent({ ...full, characters: null })).toHaveProperty('error')
    })
  })

  describe('type checking', () => {
    it('rejects a non-array characters', () => {
      expect(validateWriterEvent({ ...full, characters: 'Emma' })).toHaveProperty('error')
    })

    it('rejects non-string entries inside characters', () => {
      expect(validateWriterEvent({ ...full, characters: ['Emma', 42] })).toHaveProperty('error')
    })

    it('accepts an empty characters array and an empty title', () => {
      expect(validateWriterEvent({ ...full, characters: [], title: '' })).toEqual({
        event: { ...full, characters: [], title: '' },
      })
    })
  })

  it('drops book_chapters rather than forwarding it', () => {
    // Legacy title+positional tagging, retired in LOOM-40. Loom never authors
    // it, so it must not survive into the outgoing body even if a caller sends
    // one.
    const got = validateWriterEvent({ ...full, book_chapters: [{ book: 'Faded', chapter: 3 }] })
    expect(got).toEqual({ event: full })
    expect(got).not.toHaveProperty('event.book_chapters')
  })
})
