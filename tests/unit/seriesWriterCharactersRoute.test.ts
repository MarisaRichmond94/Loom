import { readFileSync } from 'fs'
import path from 'path'

// A source-level guard (LOOM-104), in the same spirit as
// chapterEventsRoute.test.ts — a different write-on-read hazard, same shape of
// invisible failure.
//
// `GET /api/plan/characters` on WriteAI's side WRITES TO DISK: it seeds the
// pool from canon on first call, prunes entries canon now classifies as
// non-characters, and self-heals `books` from numbers to names — saving the
// file whenever any of that changes.
//
// The series Characters tab renders this route on every visit. Pointing it at
// WriteAI instead of Loom's snapshot would look completely correct — the same
// characters, the same fields — while mutating another app's store on every
// page load. That is exactly why the snapshot table exists, and why the check
// belongs at source level rather than in a behaviour test.
/**
 * Source with comments removed.
 *
 * Both files DOCUMENT the endpoint they must not call — that warning is the
 * main reason the next person will not call it, so the guard has to read code
 * rather than prose. Checking the raw text failed on its own documentation,
 * and the fix must not be to delete the warning.
 */
function code(file: string): string {
  return readFileSync(path.join(__dirname, '../..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const routeSrc = code('src/app/api/series/[seriesId]/writer-characters/route.ts')
const libSrc = code('src/lib/writerCharacterSeries.ts')

describe('GET series writer-characters reads Loom’s snapshot', () => {
  it.each([
    ['route', routeSrc],
    ['resolver', libSrc],
  ])('%s does not call WriteAI’s write-on-read character endpoint', (_label, src) => {
    expect(src).not.toContain('/api/plan/characters')
    expect(src).not.toContain('writeai/characters')
    expect(src).not.toContain('callWriteAi')
  })

  it('resolves from the snapshot table', () => {
    expect(libSrc).toContain('writerCharacterSnapshot.findMany')
  })

  it('is read-only — no writes to Loom’s own character tables either', () => {
    for (const forbidden of ['.create(', '.update(', '.upsert(', '.delete(', '.deleteMany(']) {
      expect(libSrc).not.toContain(forbidden)
    }
  })
})
