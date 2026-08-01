import { readFileSync } from 'fs'
import path from 'path'

// A source-level guard, mirroring the events one (LOOM-33 / LOOM-42).
//
// GET /api/chapter-characters runs on every WriteAI Characters-pane render.
// Resolving chapter numbers via the canon EXPORT rather than the canon WALK
// would return the same numbers while writing .pages/.txt/.docx to ~/Writing —
// rewriting the manuscript on every page load and triggering an ingest each
// time. Nothing about that failure is visible from the response, which is
// exactly why it is pinned here rather than left to a one-off manual check.
const routeSrc = readFileSync(
  path.join(__dirname, '../../src/app/api/chapter-characters/route.ts'),
  'utf8',
)

describe('GET /api/chapter-characters stays read-only', () => {
  const writers = [
    'fs/promises',
    'writeFile',
    'mkdir',
    'buildManuscriptDocx',
    'docxToPages',
    'export/canon',
    'canonManifest',
  ]

  it.each(writers)('does not reference %s', token => {
    expect(routeSrc).not.toContain(token)
  })

  it('resolves numbers through the read-only canon walk', () => {
    expect(routeSrc).toContain('canonNumbersForBook')
  })
})

// The app boundary (LOOM-63).
//
// Loom owns a non-canon CYOA story; WriteAI holds canon data only. A tag marked
// non-canon must therefore never cross this seam. Pinned at source level for
// the same reason as the read-only rule above: the failure is INVISIBLE from
// the response — WriteAI would simply start showing chapters from a story it is
// not supposed to know exists, and nothing would report it.
describe('GET /api/chapter-characters excludes non-canon tags', () => {
  it('filters nonCanon in the query', () => {
    expect(routeSrc).toContain('nonCanon: false')
  })

  it('filters in the DATABASE, not after the fact', () => {
    // A post-query .filter() would still be correct today, but it puts the rule
    // one refactor away from being dropped while the query keeps "working".
    const where = routeSrc.slice(routeSrc.indexOf('findMany'), routeSrc.indexOf('select:'))
    expect(where).toContain('nonCanon: false')
  })
})
