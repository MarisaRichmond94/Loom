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

describe('every colour the Explore UI uses has a light-mode value', () => {
  // The staleness banner shipped rendering a near-black brown on Loom's cream
  // page, because `--color-choice-amber-*` existed only in the dark @theme
  // block — `.light-body` overrode kill and spare and never amber, since
  // nothing outside the choice panels had used it.
  //
  // The failure mode is the reason this is pinned: it is INVISIBLE in dark
  // mode, which is where a token gets eyeballed, and the author pages are used
  // in light mode day to day. A missing override is not a broken build, a
  // failed test, or a console warning — it is just the wrong colour, in the
  // one theme the developer was not looking at.
  // The light-mode palette moved to shared/light.css when the reader app began
  // importing it (LOOM-131) — both apps resolve against one copy rather than
  // drifting. Read both files so this guard follows the values wherever they
  // live: globals.css still carries the editor-only .light-body rules.
  const css = [
    path.join(__dirname, '../../src/app/globals.css'),
    path.join(__dirname, '../../shared/light.css'),
  ].map(p => readFileSync(p, 'utf8')).join('\n')
  // `.light-body` gained a second selector when the reader app needed the same
  // palette applied pre-paint (`html.pre-light body`), so the block no longer
  // opens immediately after the class name. Match through any selector list up
  // to the brace rather than assuming one selector.
  const lightBlocks = [...css.matchAll(/\.light-body[^{]*\{([\s\S]*?)\}/g)]
    .map(m => m[1])
    .join('\n')

  // Everything ExploreStalenessBanner and ExploreSources resolve through.
  const used = [
    '--color-choice-amber-bg',
    '--color-choice-amber-border',
    '--color-choice-amber',
    '--color-choice-kill-bg',
    '--color-choice-kill-border',
    '--color-choice-kill',
    '--color-choice-spare',
  ]

  it.each(used)('%s is redefined for light mode', token => {
    // `token:` rather than a bare match, so `--color-choice-amber` is not
    // satisfied by `--color-choice-amber-bg` happening to contain it.
    expect(lightBlocks).toContain(`${token}:`)
  })
})

describe('the Explore panel does not scroll the page out from under the writer', () => {
  // Three separate bugs presented as one symptom — "the page jumps around":
  //
  //  1. `scrollIntoView` walks EVERY scrollable ancestor, so pinning the
  //     conversation to its newest message also scrolled `<main>`. Opening a
  //     chat from history changed the messages, and the page went with them.
  //  2. The chapter viewer centred its cited paragraph from a ref CALLBACK,
  //     which re-fires on every render — so it re-scrolled on each keystroke
  //     in the composer.
  //  3. The citation card navigated with `window.location.href`, a full
  //     document load that threw away the conversation to reach a route Next
  //     can push to client-side.
  //
  // All three are invisible in a unit test of behaviour and obvious in the
  // source, so they are pinned here.
  const panels = [
    'components/explore/ExplorePanel.tsx',
    'components/explore/ExploreChapterViewer.tsx',
    'components/explore/ExploreSources.tsx',
    'components/explore/ExploreHistory.tsx',
  ]

  it.each(panels)('%s never calls scrollIntoView', file => {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toContain('scrollIntoView')
  })

  it.each(panels)('%s never assigns window.location', file => {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toContain('window.location')
  })

  it('scrolls the conversation by its own scrollTop', () => {
    expect(read('components/explore/ExplorePanel.tsx')).toContain('streamRef.current')
  })

  it.each([
    ['the conversation', 'components/explore/ExplorePanel.tsx'],
    ['the chapter viewer', 'components/explore/ExploreChapterViewer.tsx'],
    ['the history drawer', 'components/explore/ExploreHistory.tsx'],
  ])('%s contains its own overscroll', (_name, file) => {
    // Without this, reaching the end of an inner scroller hands the wheel to
    // the page behind it — the "strange movement" of two nested scrollers.
    expect(read(file)).toContain('overscroll-contain')
  })
})

describe('the scope route is safe to call on tab open', () => {
  it('is a GET only', () => {
    expect(scopeRouteSrc).toContain('export async function GET')
    expect(scopeRouteSrc).not.toContain('export async function POST')
  })
})
