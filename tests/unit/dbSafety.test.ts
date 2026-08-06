import path from 'node:path'
import { assertNotProductionDb, isProductionDbPath, resolveDbPath } from '@/lib/dbSafety'

// LOOM-125. These assertions are the difference between "we agreed not to
// point things at production" and "it cannot be pointed at production".

describe('resolveDbPath', () => {
  it('strips the file: prefix and resolves against cwd', () => {
    expect(resolveDbPath('file:./dev.db', '/repo')).toBe('/repo/dev.db')
    expect(resolveDbPath('file:sandbox.db', '/repo')).toBe('/repo/sandbox.db')
  })

  it('passes through an absolute path unchanged', () => {
    expect(resolveDbPath('file:/var/data/x.db', '/repo')).toBe('/var/data/x.db')
  })

  it('resolves a relative climb, so ../../dev.db cannot sneak past the check', () => {
    expect(resolveDbPath('file:../../dev.db', '/repo/a/b')).toBe('/repo/dev.db')
  })
})

describe('isProductionDbPath', () => {
  it('recognises the manuscript wherever it lives', () => {
    expect(isProductionDbPath('/repo/dev.db')).toBe(true)
    expect(isProductionDbPath('dev.db')).toBe(true)
    expect(isProductionDbPath('/somewhere/else/entirely/dev.db')).toBe(true)
  })

  it('recognises pre-migration snapshots — they are full copies of the prose', () => {
    expect(isProductionDbPath('/repo/dev.db.pre-explore-20260805')).toBe(true)
    expect(isProductionDbPath('/repo/dev.db.pre-timeline-20260805')).toBe(true)
  })

  it('leaves the reader tier and the fixture alone', () => {
    for (const safe of ['sandbox.db', 'content.db', 'reader.db', '/repo/reader/content.db']) {
      expect(isProductionDbPath(safe)).toBe(false)
    }
  })

  it('does not false-positive on a name that merely contains dev.db', () => {
    // Prefix matching is on the BASENAME, so a directory called dev.db-ish or a
    // file named my-dev.db.bak must not be swept up — over-triggering would
    // train people to work around the guard, which is worse than not having it.
    expect(isProductionDbPath('/repo/my-dev.db.bak')).toBe(false)
    expect(isProductionDbPath('/repo/dev.db-ish/content.db')).toBe(false)
  })
})

describe('assertNotProductionDb', () => {
  it('throws for the manuscript, naming the context and the resolved path', () => {
    expect(() => assertNotProductionDb('/repo/dev.db', 'publish step')).toThrow(/publish step/)
    expect(() => assertNotProductionDb('/repo/dev.db', 'publish step')).toThrow(/\/repo\/dev\.db/)
  })

  it('tells the caller what to do instead, not just that it failed', () => {
    expect(() => assertNotProductionDb('/repo/dev.db', 'x')).toThrow(/sandbox\.db/)
  })

  it('is silent for anything else', () => {
    expect(() => assertNotProductionDb('/repo/sandbox.db', 'tests')).not.toThrow()
  })
})

describe('the Jest guard itself', () => {
  it('has repointed DATABASE_URL away from the manuscript', () => {
    // tests/setup/dbGuard.ts runs before this file is imported. Without it,
    // src/lib/prisma.ts would fall back to 'file:./dev.db'.
    const url = process.env.DATABASE_URL
    expect(url).toBeDefined()
    expect(isProductionDbPath(resolveDbPath(url as string))).toBe(false)
    expect(path.basename(resolveDbPath(url as string))).toBe('sandbox.db')
  })
})
