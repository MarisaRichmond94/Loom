/**
 * Pins the invariant the Paths tab depends on: looking cannot change anything.
 *
 * The Outline and Explore tabs both had to be fixed for writing on read, and
 * this route walks the entire series on every open. A mutation that slipped in
 * here would fire against the writer's whole manuscript, so the guard is a test
 * rather than a comment: every Prisma method except the read ones throws.
 */

const READ_METHODS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate'])

/** Rows shaped enough for the analyzer to run end to end. */
const ROWS: Record<string, unknown[]> = {
  book: [{ id: 'bk1', title: 'Book One', order: 1 }],
  chapter: [{ id: 'ch1', bookId: 'bk1', title: 'Chapter 1', order: 0, condition: null }],
  contentBlock: [{ id: 'frag1', chapterId: 'ch1', order: 0, type: 'conditional_fragment', condition: null }],
  choice: [],
  conditionalOverride: [{
    id: 'ov1', conditionalFragmentId: 'frag1', order: 1,
    // Reads a variable that does not exist — so the route must report it.
    condition: JSON.stringify({ ghost: true }), endsChapter: false,
  }],
  storyVariable: [{ name: 'real', type: 'boolean', defaultValue: 'false' }],
}

const attemptedWrites: string[] = []

jest.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_t2, method: string) => {
        if (!READ_METHODS.has(method)) {
          return (...args: unknown[]) => {
            attemptedWrites.push(`${model}.${method}`)
            throw new Error(`Reachability route attempted a write: ${model}.${method}(${JSON.stringify(args)})`)
          }
        }
        return async () => ROWS[model] ?? []
      },
    }),
  }),
}))

import { GET } from '@/app/api/series/[seriesId]/reachability/route'

describe('GET /api/series/[seriesId]/reachability', () => {
  beforeEach(() => { attemptedWrites.length = 0 })

  it('never writes — opening the tab cannot dirty the manuscript', async () => {
    const res = await GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ seriesId: 'series1' }),
    })

    expect(attemptedWrites).toEqual([])
    expect(res.status).toBe(200)
  })

  it('returns findings computed from the rows it read', async () => {
    const res = await GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ seriesId: 'series1' }),
    })
    const body = await res.json()

    expect(body.summary.dead).toBe(1)
    const finding = body.findings.find((f: { id: string }) => f.id === 'ov1')
    expect(finding.kind).toBe('undeclared-variable')
    expect(finding.detail).toContain('ghost')
    expect(attemptedWrites).toEqual([])
  })

  it('answers with an empty report for a series that has no books', async () => {
    const saved = ROWS.book
    ROWS.book = []
    try {
      const res = await GET(new Request('http://localhost/x'), {
        params: Promise.resolve({ seriesId: 'empty' }),
      })
      const body = await res.json()
      expect(body.findings).toEqual([])
      expect(body.summary.chapters).toBe(0)
    } finally {
      ROWS.book = saved
    }
  })
})
