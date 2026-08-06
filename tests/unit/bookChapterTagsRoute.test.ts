import { readFileSync } from 'fs'
import path from 'path'

// Third route under the same guard (LOOM-120/121), after chapterEventsRoute and
// bookEventsRoute.
//
// GET /api/series/[id]/books/[id]/chapter-tags runs on every render of the
// Chapters tab. Resolving chapter numbers via the canon EXPORT instead of the
// canon WALK would return identical numbers while writing .pages/.txt/.docx to
// ~/Writing as a side effect — rewriting the manuscript on every page load and
// kicking off a WriteAI ingest each time.
//
// Pinned at source level because the failure is invisible from the response: it
// looks like a correct answer. A comment did not stop it the first time.
const routeSrc = readFileSync(
  path.join(__dirname, '../../src/app/api/series/[seriesId]/books/[bookId]/chapter-tags/route.ts'),
  'utf8',
)

describe('GET book chapter-tags stays read-only', () => {
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

  it('performs no Prisma writes', () => {
    // The view is a lens over existing data. Any write here would be a bug,
    // and the tab is one of the most frequently rendered surfaces there is.
    for (const write of ['.create(', '.update(', '.upsert(', '.delete(', '.createMany(']) {
      expect(routeSrc).not.toContain(write)
    }
  })

  it('never reaches WriteAI', () => {
    // Summaries are joined on the client, through the outline cache that the
    // Outline tab already populates. Fetching WriteAI here would make a Loom
    // view fail whenever the other app is down — and, worse, `get_outline`
    // seeds and SAVES on a GET.
    expect(routeSrc).not.toContain('writeai')
    expect(routeSrc).not.toContain('callWriteAi')
  })
})

describe('GET book chapter-tags keeps non-canon rows', () => {
  // The mirror image of the seam rule. /api/chapter-characters and
  // /api/chapter-events MUST filter non-canon because WriteAI reads them and
  // holds canon only. This route MUST NOT: the branch story is the thing the
  // Chapters tab exists to show, and filtering here would silently hide every
  // Bonus Chapter appearance while looking entirely correct.
  it('does not filter on nonCanon in its queries', () => {
    expect(routeSrc).not.toContain('nonCanon: false')
  })

  it('reads the flag so the view can badge it', () => {
    expect(routeSrc).toContain('nonCanon: true')
  })
})
