import { validateWriterCharacterMetaPatch } from '@/lib/writerCharacterMeta'

const patch = (body: unknown) => {
  const r = validateWriterCharacterMetaPatch(body)
  if ('error' in r) throw new Error(`unexpected error: ${r.error}`)
  return r.patch
}

describe('validateWriterCharacterMetaPatch — absent vs null', () => {
  it('omits fields that were not sent, so a partial update stays partial', () => {
    // The opposite rule to writerCharacters.ts, on purpose: these fields live
    // in Loom's own database, so absent means "leave alone" rather than
    // "delete".
    expect(patch({ age: 15 })).toEqual({ age: 15 })
  })

  it('treats null as clear-this-field', () => {
    expect(patch({ deathBookId: null })).toEqual({ deathBookId: null })
  })

  it('treats an empty string as clear, the way a cleared input sends it', () => {
    expect(patch({ age: '', firstBookId: '' })).toEqual({ age: null, firstBookId: null })
  })

  it('accepts a numeric string from a number input', () => {
    expect(patch({ age: '17' })).toEqual({ age: 17 })
  })
})

describe('validateWriterCharacterMetaPatch — rejections', () => {
  const rejects = (body: unknown) => expect(validateWriterCharacterMetaPatch(body)).toHaveProperty('error')

  it('rejects a non-object body', () => {
    rejects(null)
    rejects([])
    rejects('age=15')
  })

  it('rejects a non-integer or nonsense age', () => {
    rejects({ age: 15.5 })
    rejects({ age: 'fifteen' })
    rejects({ age: true })
  })

  it('rejects an implausible age rather than storing it', () => {
    rejects({ age: -1 })
    rejects({ age: 500 })
  })

  it('rejects a non-boolean starred', () => {
    rejects({ starred: 'yes' })
    rejects({ starred: 1 })
  })

  it('rejects a book id that is not a string', () => {
    rejects({ lastBookId: 42 })
    rejects({ firstBookId: { id: 'b1' } })
  })

  it('rejects a body with nothing recognisable in it', () => {
    // Silently succeeding at a no-op hides a typo'd field name.
    rejects({})
    rejects({ name: 'Jared Gatlin' })
  })
})

describe('validateWriterCharacterMetaPatch — what it refuses to touch', () => {
  it('ignores WriteAI-owned fields entirely', () => {
    // name, traits, aliases and the rest belong to WriteAI. Accepting them
    // here would create a second place they appear to be editable, and only
    // one of the two would win.
    const r = validateWriterCharacterMetaPatch({ name: 'x', traits: ['y'], aliases: 'z', starred: true })
    expect(r).toEqual({ patch: { starred: true } })
  })
})
