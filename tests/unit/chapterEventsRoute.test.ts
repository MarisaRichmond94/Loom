import { readFileSync } from 'fs'
import path from 'path'

// A source-level guard, not a behaviour test (LOOM-32 / LOOM-38).
//
// GET /api/chapter-events is called on every WriteAI timeline render. Resolving
// chapter numbers via the canon EXPORT instead of the canon WALK would return
// the same numbers while writing .pages/.txt/.docx to ~/Writing as a side
// effect — rewriting the manuscript on every page load and kicking off a
// WriteAI ingest each time.
//
// Nothing about that failure is visible from the response, which is exactly why
// it is worth pinning here: the ticket's acceptance check is "confirm no file
// under ~/Writing changed", and a human only runs that once. This runs forever.
const routeSrc = readFileSync(
  path.join(__dirname, '../../src/app/api/chapter-events/route.ts'),
  'utf8',
)

describe('GET /api/chapter-events stays read-only', () => {
  // Everything the canon export route pulls in to write manuscript files.
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

// The app boundary (LOOM-78).
//
// Loom owns a non-canon CYOA story; WriteAI holds canon data only. A tag marked
// non-canon must therefore never cross this seam. Pinned at source level for
// the same reason as the read-only rule above: the failure is INVISIBLE from
// the response — WriteAI's timeline would simply start showing chapter links
// from a story it is not supposed to know exists, and nothing would report it.
describe('GET /api/chapter-events excludes non-canon tags', () => {
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
