import { writerPortraitUrl, writeAiPhotoUrl, type PortraitSource } from '@/lib/writerPortrait'

const character = (over: Partial<PortraitSource> = {}): PortraitSource => ({
  id: 'wc-abc12345',
  hasBookAvatar: false,
  hasCanonicalAvatar: false,
  writerPhotoUrl: '/api/plan/photos/wc-abc12345.jpg',
  ...over,
})

describe('writerPortraitUrl — the fallback chain', () => {
  it('prefers this book\'s portrait', () => {
    expect(writerPortraitUrl(character({ hasBookAvatar: true, hasCanonicalAvatar: true }), 'book-2'))
      .toBe('/characters/wc-abc12345-book-2.jpg')
  })

  it('falls back to WriteAI when Loom holds no file', () => {
    expect(writerPortraitUrl(character(), 'book-2')).toBe('/api/writeai/photo/wc-abc12345.jpg')
  })

  it('falls back to a canonical Loom file when one exists', () => {
    expect(writerPortraitUrl(character({ hasCanonicalAvatar: true }), 'book-2'))
      .toBe('/characters/wc-abc12345.jpg')
  })

  it('ignores a book portrait when rendering outside a book', () => {
    // The series-level cast list has no book context; a per-book portrait
    // must not leak into it.
    expect(writerPortraitUrl(character({ hasBookAvatar: true }), null))
      .toBe('/api/writeai/photo/wc-abc12345.jpg')
  })

  it('returns null when there is no portrait anywhere', () => {
    expect(writerPortraitUrl(character({ writerPhotoUrl: null }), 'book-2')).toBeNull()
  })

  it('busts the cache on Loom-served files only', () => {
    expect(writerPortraitUrl(character({ hasBookAvatar: true }), 'book-2', 42))
      .toBe('/characters/wc-abc12345-book-2.jpg?t=42')
    // WriteAI's proxy already sends Cache-Control: no-cache.
    expect(writerPortraitUrl(character(), 'book-2', 42)).toBe('/api/writeai/photo/wc-abc12345.jpg')
  })
})

describe('writeAiPhotoUrl', () => {
  it('routes a WriteAI path through Loom\'s proxy', () => {
    expect(writeAiPhotoUrl('/api/plan/photos/extracted-jared-gatlin.jpg'))
      .toBe('/api/writeai/photo/extracted-jared-gatlin.jpg')
  })

  it('carries WriteAI\'s own version query across', () => {
    // Its re-upload cache-buster — dropping it would show the old portrait.
    expect(writeAiPhotoUrl('/api/plan/photos/wc-abc12345.jpg?v=1783028749603659541'))
      .toBe('/api/writeai/photo/wc-abc12345.jpg?v=1783028749603659541')
  })

  it('refuses a filename that could climb out of the photos directory', () => {
    expect(writeAiPhotoUrl('/api/plan/photos/../../etc/passwd')).toBeNull()
    expect(writeAiPhotoUrl('/api/plan/photos/a b.jpg')).toBeNull()
  })

  it('returns null for a missing photo', () => {
    expect(writeAiPhotoUrl(null)).toBeNull()
    expect(writeAiPhotoUrl('')).toBeNull()
  })
})
