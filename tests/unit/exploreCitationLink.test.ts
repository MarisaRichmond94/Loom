import { readFileSync } from 'fs'
import path from 'path'

// A source-level guard (LOOM-115), the sibling of chapterEventsRoute.test.ts.
//
// Clicking a citation resolves a chapter NUMBER to a Loom cuid. There are two
// ways to get that number, and they are not interchangeable:
//
//   canonNumbersForBook()  walks canon in memory. Read-only.
//   POST .../export/canon  returns the same number, and writes
//                          .pages/.txt/.docx to the writer's folder on the way.
//
// The second would rewrite the manuscript on EVERY citation click and trigger a
// WriteAI ingest each time. Nothing about that failure is visible from the
// response — the link works, the answer is right, and files churn under
// ~/Writing — which is exactly why it is pinned here rather than trusted to a
// one-off manual check.

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')

const linkSrc = read('app/api/writeai/chat/chapter-link/route.ts')
const chapterSrc = read('app/api/writeai/chat/chapter/route.ts')
const viewerSrc = read('components/explore/ExploreChapterViewer.tsx')

/** Comments name the forbidden things in order to warn about them. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('citation → chapter resolution stays read-only', () => {
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

  it.each(writers)('chapter-link does not reference %s', token => {
    expect(code(linkSrc)).not.toContain(token)
  })

  it('resolves numbers through the read-only canon walk', () => {
    expect(linkSrc).toContain('canonNumbersForBook')
  })

  it('does not trigger an ingest', () => {
    for (const src of [linkSrc, chapterSrc, viewerSrc]) {
      expect(code(src)).not.toContain('/api/ingest')
    }
  })
})

describe('the citation viewer reads the chapter, and only reads it', () => {
  it('uses the verified pure-read text endpoint', () => {
    expect(chapterSrc).toContain('/chapters/')
    expect(chapterSrc).toContain('/text')
  })

  it('is a GET only — nothing here may mutate WriteAI', () => {
    expect(chapterSrc).toContain('export async function GET')
    expect(chapterSrc).not.toContain('export async function POST')
    expect(chapterSrc).not.toContain('export async function PUT')
    expect(chapterSrc).not.toContain('export async function DELETE')
  })

  it('never reaches a write-on-read plan endpoint', () => {
    for (const src of [linkSrc, chapterSrc, viewerSrc]) {
      expect(code(src)).not.toContain('/api/plan/')
    }
  })
})

describe('an unresolvable citation degrades rather than disappearing', () => {
  it('keeps the card and explains, instead of dropping the link silently', () => {
    // The failure this protects against is a citation quietly vanishing when
    // the index and the manuscript disagree — which is precisely the moment
    // the writer wants to be told.
    expect(viewerSrc).toContain('renumbered since')
  })
})
