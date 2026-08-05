import { readFileSync } from 'fs'
import path from 'path'

import { clampBookSelection, clampPovSelection, type ExploreScope } from '@/lib/exploreScope'

// The Explore tab's scoping rule (LOOM-112).
//
// Two halves, and both matter:
//
//  * BEHAVIOUR — the clamp. On a book page, Explore may draw on that book and
//    every book before it. The dropdown enforces the same rule, but a dropdown
//    is a suggestion; this is the enforcement, and its failure mode is the
//    feature spoiling the writer's own series back to her in a way that reads
//    like a correct answer.
//
//  * SOURCE — where the filter data comes from. `GET /api/plan/characters` and
//    `GET /api/plan/outline/{n}` WRITE TO DISK on a GET (INTEGRATION.md §5).
//    A character list is exactly what reaches for the first of those by
//    instinct, and nothing about that mistake is visible from the response.

const scope = (books: ExploreScope['books']): ExploreScope => ({
  books,
  povs: [
    { name: 'Jared Gatlin', chapterCount: 30, bookIds: ['b1'] },
    { name: 'Noah Gatlin', chapterCount: 29, bookIds: ['b2'] },
  ],
  lastSynced: null,
})

// Books 1-3 of the series, as a book-3 page would resolve them.
const BOOKS_1_TO_3: ExploreScope['books'] = [
  { id: 'b1', title: "Nobody's Hero", order: 1, writeaiNumber: 1 },
  { id: 'b2', title: 'Faded', order: 2, writeaiNumber: 2 },
  { id: 'b3', title: 'The Secrets We Keep', order: 3, writeaiNumber: 3 },
]

describe('clampBookSelection', () => {
  it('passes through a selection the page allows', () => {
    expect(clampBookSelection(scope(BOOKS_1_TO_3), ['b1', 'b3'])).toEqual([1, 3])
  })

  it('drops a book the page does not allow', () => {
    // 'b5' is book 5 — not in scope for a book-3 page, so it is simply absent.
    expect(clampBookSelection(scope(BOOKS_1_TO_3), ['b2', 'b5'])).toEqual([2])
  })

  it('falls back to the allowed set when the selection is entirely forbidden', () => {
    // The dangerous case. An empty book_filter reads to WriteAI as "the whole
    // series", so returning [] here would hand back exactly the spoiler the
    // clamp exists to prevent.
    expect(clampBookSelection(scope(BOOKS_1_TO_3), ['b4', 'b5'])).toEqual([1, 2, 3])
  })

  it('treats no selection as everything allowed', () => {
    expect(clampBookSelection(scope(BOOKS_1_TO_3), [])).toEqual([1, 2, 3])
    expect(clampBookSelection(scope(BOOKS_1_TO_3), undefined)).toEqual([1, 2, 3])
  })

  it('ignores books WriteAI has never ingested', () => {
    const partial = [
      ...BOOKS_1_TO_3.slice(0, 2),
      { id: 'b3', title: 'The Secrets We Keep', order: 3, writeaiNumber: null },
    ]
    expect(clampBookSelection(scope(partial), ['b1', 'b3'])).toEqual([1])
  })

  it('ignores non-string ids rather than trusting the body', () => {
    expect(clampBookSelection(scope(BOOKS_1_TO_3), [1, null, 'b2'])).toEqual([2])
  })
})

describe('clampPovSelection', () => {
  it('keeps POVs present in the allowed books', () => {
    expect(clampPovSelection(scope(BOOKS_1_TO_3), ['Noah Gatlin'])).toEqual(['Noah Gatlin'])
  })

  it('drops a POV that appears in no allowed book', () => {
    // Selecting a POV, then narrowing the books until it no longer appears,
    // must not keep filtering on it.
    expect(clampPovSelection(scope(BOOKS_1_TO_3), ['Emma Mendoza'])).toEqual([])
  })

  it('treats no selection as no POV restriction', () => {
    expect(clampPovSelection(scope(BOOKS_1_TO_3), [])).toEqual([])
  })
})

// ── Source-level guards ─────────────────────────────────────────────────────
//
// Same shape as tests/unit/chapterEventsRoute.test.ts, and for the same reason:
// the acceptance check is "confirm nothing under writer_data/ changed", and a
// human runs that once. This runs forever.

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')

const scopeSrc = read('lib/exploreScope.ts')
const serverSrc = read('lib/exploreScopeServer.ts')
const runSrc = read('app/api/writeai/chat/run/route.ts')
const scopeRouteSrc = read('app/api/writeai/chat/scope/route.ts')

describe('the Explore tab cannot reach a write-on-read endpoint', () => {
  // Both of these SAVE on an ordinary GET. Neither belongs anywhere near a
  // filter bar that opens with the tab.
  const writeOnRead = ['/api/plan/characters', '/api/plan/outline']

  it.each([
    ['exploreScope.ts', scopeSrc],
    ['exploreScopeServer.ts', serverSrc],
    ['chat/run', runSrc],
    ['chat/scope', scopeRouteSrc],
  ])('%s calls neither write-on-read endpoint', (_name, src) => {
    // Strip comments first — these endpoints are NAMED in the warnings, and a
    // bare substring check would fail on the documentation telling you not to
    // call them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const endpoint of writeOnRead) {
      expect(code).not.toContain(endpoint)
    }
  })

  it('sources the filter data from the pure-read books endpoint', () => {
    expect(serverSrc).toContain("callWriteAi('/api/books'")
  })
})

describe('the title-normalisation rule does not fork', () => {
  // exploreScope.ts keeps its own copy so it stays free of prisma (and so it
  // stays testable). Two lookups that disagree about what counts as the same
  // title is a bug that surfaces on exactly one book — `Nobody's Hero` found
  // it the first time — so the copies are pinned as identical here.
  const rule = (src: string) =>
    src.match(/normalize\('NFC'\)[^\n]*/)?.[0]?.trim()

  it('matches writeaiBooks.ts character for character', () => {
    const mine = rule(scopeSrc)
    const theirs = rule(read('lib/writeaiBooks.ts'))
    expect(mine).toBeTruthy()
    expect(mine).toEqual(theirs)
  })
})

describe('the Explore tab cannot write to WriteAI or spend without asking', () => {
  it.each([
    ['chat/run', runSrc],
    ['chat/scope', scopeRouteSrc],
  ])('%s issues no mutating verb of its own', (_name, src) => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // The one POST is the chat stream itself, which is the user pressing send.
    for (const verb of ["method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'"]) {
      expect(code).not.toContain(verb)
    }
  })

  it('never triggers an ingest', () => {
    // /api/ingest/run costs real money and rewrites the index. It belongs to
    // the sync button (LOOM-117), behind a confirmation — never to a question.
    for (const src of [scopeSrc, runSrc, scopeRouteSrc]) {
      expect(src).not.toContain('/api/ingest')
    }
  })

  it('never resolves book identity positionally', () => {
    // Book.order ↔ book_number agree only until someone inserts a book.
    expect(scopeSrc).toContain('normBookTitle')
  })

  it('holds no ANTHROPIC_API_KEY — spend stays WriteAI’s', () => {
    // Comments stripped: the routes NAME the key in the comment explaining
    // that Loom does not have it, which is the opposite of the thing being
    // guarded against.
    for (const src of [scopeSrc, serverSrc, runSrc, scopeRouteSrc]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toContain('ANTHROPIC_API_KEY')
    }
  })
})

describe('the scope route is safe to call on tab open', () => {
  it('is a GET only', () => {
    expect(scopeRouteSrc).toContain('export async function GET')
    expect(scopeRouteSrc).not.toContain('export async function POST')
  })
})
