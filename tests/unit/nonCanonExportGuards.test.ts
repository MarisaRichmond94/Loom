import { readFileSync } from 'fs'
import path from 'path'

// The guards that keep an alternate timeline off the disk (LOOM-149, under
// LOOM-146).
//
// Pinned at source level, the same way the chapter-character/event seam rules
// are, and for the same reason: every failure here is INVISIBLE from the
// response. A missing refusal does not error — it quietly writes alt-timeline
// prose into ~/Writing, where WriteAI ingests it as canon on the next sync. A
// missing export-status filter does not error either; it just warns every night
// about a book that is behaving perfectly, until the warning means nothing.

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')

const canonRoute = read('app/api/series/[seriesId]/books/[bookId]/export/canon/route.ts')
const statusRoute = read('app/api/export-status/route.ts')
const loader = read('lib/manuscript/loadBook.ts')

describe('the canon export refuses non-canon books', () => {
  it('checks the flag and returns a 4xx', () => {
    expect(canonRoute).toContain('!data.canon')
    expect(canonRoute).toContain('status: 409')
  })

  // Ordering assertions have to be made against the HANDLER BODY, not the whole
  // file: every name below is also imported or declared at the top, so a naive
  // indexOf over the file measures the import site and reports nothing useful.
  const body = canonRoute.slice(canonRoute.indexOf('export async function POST'))
  const guardAt = body.indexOf('!data.canon')

  it('refuses BEFORE resolving a destination folder', () => {
    // findCanonDestDir({ create: true }) MAKES the directory. Refusing after it
    // would leave an empty folder under the canon root for a book that must
    // never have one — and the export-status check treats a folder's absence as
    // meaningful.
    expect(guardAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(body.indexOf('findCanonDestDir'))
  })

  it('refuses BEFORE anything is written', () => {
    for (const writer of ['writeAtomic(', 'buildManuscriptDocx(', 'docxToPages(', 'announceExport']) {
      expect(guardAt).toBeLessThan(body.indexOf(writer))
    }
  })

  it('gets the flag from the loader rather than a second query', () => {
    expect(loader).toContain('canon: book.canon')
  })
})

describe('export-status ignores non-canon books', () => {
  it('filters them out in the query', () => {
    expect(statusRoute).toContain('canon: true')
  })

  it('filters in the DATABASE, alongside the demo-series filter', () => {
    const where = statusRoute.slice(statusRoute.indexOf('prisma.book.findMany'))
    const clause = where.slice(0, where.indexOf('select:'))
    expect(clause).toContain('demo: false')
    expect(clause).toContain('canon: true')
  })
})
