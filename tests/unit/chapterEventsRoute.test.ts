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
