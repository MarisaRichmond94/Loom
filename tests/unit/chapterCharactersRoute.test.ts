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
