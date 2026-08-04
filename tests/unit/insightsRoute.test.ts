import { readFileSync } from 'fs'
import path from 'path'

// Source-level guards for the insights proxy (LOOM-91).
//
// Same reasoning as chapterEventsRoute.test.ts: the failures pinned here are
// invisible from the response, so a human checks them once and a test checks
// them forever.
const routeSrc = readFileSync(
  path.join(__dirname, '../../src/app/api/writeai/insights/route.ts'),
  'utf8',
)

// The route resolves a chapter's canon number, which is exactly where the
// manuscript-writing export is easy to reach for by mistake.
describe('GET /api/writeai/insights stays read-only', () => {
  const writers = [
    'fs/promises',
    'writeFile',
    'mkdir',
    'buildManuscriptDocx',
    'docxToPages',
    'export/canon',
  ]

  it.each(writers)('does not reference %s', token => {
    expect(routeSrc).not.toContain(token)
  })

  it('resolves the chapter number through the read-only walk', () => {
    expect(routeSrc).toContain('reviewNumberForChapter')
  })

  it('makes no non-GET call to WriteAI', () => {
    expect(routeSrc).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
  })
})

// The degradation contract (LOOM-92).
//
// Every "nothing to show" case is a DIFFERENT sentence in the tab, and the
// difference is carried by `reason`. Collapsing two of them — or letting one
// become an empty payload — turns "not analysed yet" into "this chapter is
// empty", which is a lie about the writer's own manuscript.
describe('empty states stay distinguishable', () => {
  it.each(['chapter-not-addressable', 'not-analyzed', 'writeai-unavailable'])(
    'carries the %s reason',
    reason => {
      expect(routeSrc).toContain(reason)
    },
  )

  it('answers the unaddressable case without calling WriteAI', () => {
    // The early return must come before the first callWriteAi. A chapter with
    // no canon address cannot have been analysed, and asking anyway makes an
    // offline WriteAI look like a broken chapter.
    // The RETURN, not the type declaration — hence the `reason:` prefix — and
    // the call site rather than the import.
    const unaddressable = routeSrc.indexOf("reason: 'chapter-not-addressable'")
    const firstCall = routeSrc.indexOf('writeaiBookNumber(book.title)')
    expect(unaddressable).toBeGreaterThan(-1)
    expect(firstCall).toBeGreaterThan(unaddressable)
  })
})

// The roster boundary (LOOM-91 / LOOM-33).
//
// WriteAI's extracted `characters` is a chunk-derived twin of the cast the
// Characters tab shows from the writer's own tags. Two disagreeing rosters one
// tab apart is worse than one, so the array is dropped at the seam rather than
// hidden in the panel — otherwise a second consumer quietly grows on it.
describe('extracted characters do not cross the seam', () => {
  it('does not read the characters array off the payload', () => {
    expect(routeSrc).not.toMatch(/data\.characters/)
  })
})
