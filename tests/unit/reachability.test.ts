import { analyzeReachability, type ReachabilityInput } from '@/lib/reachability'

// Minimal spine builder. Chapters are linear (no choice sets targetChapterId
// in real data, and the analyzer assumes that spine), so a fixture is just an
// ordered list of blocks hung off one chapter per entry.
function build(partial: Partial<ReachabilityInput>): ReachabilityInput {
  return {
    books: [{ id: 'bk1', title: 'Book One', order: 1 }],
    chapters: [], blocks: [], choices: [], overrides: [], variables: [],
    ...partial,
  }
}

const chapter = (id: string, order: number, condition: string | null = null) =>
  ({ id, bookId: 'bk1', title: `Chapter ${order}`, order, condition })

const fragment = (id: string, chapterId: string, order: number) =>
  ({ id, chapterId, order, type: 'conditional_fragment', condition: null })

const choicePoint = (id: string, chapterId: string, order: number) =>
  ({ id, chapterId, order, type: 'choice_point', condition: null })

const option = (
  id: string, choicePointId: string, order: number, label: string, sets: object,
) => ({
  id, choicePointId, order, label,
  setsVariables: JSON.stringify(sets), condition: null,
  isBadEnding: false, endsChapter: false,
})

const override = (id: string, fragId: string, order: number, condition: object) =>
  ({ id, conditionalFragmentId: fragId, order, condition: JSON.stringify(condition), endsChapter: false })

describe('analyzeReachability', () => {
  // ── The three real bugs from the production snapshot, as fixtures ──────────

  it('flags an override whose condition names a variable that was never declared', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'didNoahUseSteroids', type: 'boolean', defaultValue: 'true' }],
      chapters: [chapter('ch1', 1)],
      blocks: [fragment('frag1', 'ch1', 0)],
      // `isNoahUsingSteroids` does not exist — the real typo in Faded ch 16.
      overrides: [override('ov1', 'frag1', 1, {
        didNoahUseSteroids: true, isNoahUsingSteroids: true,
      })],
    }))

    const f = report.findings.find(x => x.id === 'ov1')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('undeclared-variable')
    expect(f!.severity).toBe('dead')
    expect(f!.detail).toContain('isNoahUsingSteroids')
    expect(f!.matched).toBe(0)
  })

  it('flags an override that an earlier, broader sibling always preempts', () => {
    const report = analyzeReachability(build({
      variables: [
        { name: 'pregnant', type: 'boolean', defaultValue: 'false' },
        { name: 'miscarriage', type: 'boolean', defaultValue: 'false' },
      ],
      chapters: [chapter('ch1', 1)],
      blocks: [fragment('frag1', 'ch1', 0)],
      overrides: [
        // #1's condition is a strict subset of #3's, so #1 always wins first.
        override('ov1', 'frag1', 1, { pregnant: false }),
        override('ov3', 'frag1', 3, { pregnant: false, miscarriage: false }),
      ],
    }))

    const f = report.findings.find(x => x.id === 'ov3')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('always-preempted')
    expect(f!.detail).toContain('#1')
    // Never even evaluated — the first match short-circuits.
    expect(f!.evaluated).toBe(0)
    // The sibling that wins is not itself a finding.
    expect(report.findings.find(x => x.id === 'ov1')).toBeUndefined()
  })

  it('flags a combination that the choices themselves make impossible', () => {
    // One option sets both variables together, which is what locks the pair:
    // "learned she is pregnant" only ever comes with "did not let her walk out".
    const report = analyzeReachability(build({
      variables: [
        { name: 'pregnant', type: 'boolean', defaultValue: 'false' },
        { name: 'walkedOut', type: 'boolean', defaultValue: 'true' },
      ],
      chapters: [chapter('ch1', 1), chapter('ch2', 2)],
      blocks: [choicePoint('cp1', 'ch1', 0), fragment('frag1', 'ch2', 0)],
      choices: [
        option('c0', 'cp1', 0, 'Ask her', { pregnant: true, walkedOut: false }),
        option('c1', 'cp1', 1, 'Say nothing', { pregnant: false }),
      ],
      overrides: [
        override('ovA', 'frag1', 1, { walkedOut: true, pregnant: false }),
        // Reachable only if walkedOut && pregnant — which no path produces.
        override('ovB', 'frag1', 2, { walkedOut: true, pregnant: true }),
      ],
    }))

    const f = report.findings.find(x => x.id === 'ovB')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('unreachable-combination')
    expect(f!.evaluated).toBeGreaterThan(0)
    expect(f!.matched).toBe(0)
  })

  // ── Warnings ───────────────────────────────────────────────────────────────

  it('flags two overrides sharing one position as an undefined winner', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'shot', type: 'boolean', defaultValue: 'false' }],
      chapters: [chapter('ch1', 1)],
      blocks: [fragment('frag1', 'ch1', 0)],
      overrides: [
        override('ovA', 'frag1', 3, { shot: true }),
        override('ovB', 'frag1', 3, { shot: false }),
      ],
    }))

    const f = report.findings.find(x => x.kind === 'duplicate-order')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('warning')
    expect(f!.title).toContain('#3')
  })

  it('flags a variable a choice writes but nothing declared', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'killedGrandpa', type: 'boolean', defaultValue: 'true' }],
      chapters: [chapter('ch1', 1)],
      blocks: [choicePoint('cp1', 'ch1', 0)],
      choices: [
        option('c0', 'cp1', 0, 'Yes', { killedGrandpa: true, jaredKillCount: 3 }),
        option('c1', 'cp1', 1, 'No', { killedGrandpa: false, jaredKillCount: 2 }),
      ],
    }))

    const f = report.findings.find(x => x.kind === 'undeclared-write')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('warning')
    expect(f!.title).toContain('jaredKillCount')
    expect(f!.detail).toContain('"Yes"')
  })

  it('flags declared variables that no condition reads', () => {
    const report = analyzeReachability(build({
      variables: [
        { name: 'used', type: 'boolean', defaultValue: 'false' },
        { name: 'emmaTrustScore', type: 'number', defaultValue: '0' },
      ],
      chapters: [chapter('ch1', 1)],
      blocks: [fragment('frag1', 'ch1', 0)],
      overrides: [override('ov1', 'frag1', 1, { used: false })],
    }))

    const f = report.findings.find(x => x.kind === 'never-read')
    expect(f).toBeDefined()
    expect(f!.detail).toContain('emmaTrustScore')
    expect(f!.detail).not.toContain('used,')
  })

  // ── The quiet case, which matters just as much ─────────────────────────────

  it('reports nothing when every branch is reachable', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'shot', type: 'boolean', defaultValue: 'false' }],
      chapters: [chapter('ch1', 1), chapter('ch2', 2)],
      blocks: [choicePoint('cp1', 'ch1', 0), fragment('frag1', 'ch2', 0)],
      choices: [
        option('c0', 'cp1', 0, 'Duck', { shot: false }),
        option('c1', 'cp1', 1, 'Stand', { shot: true }),
      ],
      overrides: [
        override('ovA', 'frag1', 1, { shot: true }),
        override('ovB', 'frag1', 2, { shot: false }),
      ],
    }))

    expect(report.findings).toEqual([])
    expect(report.summary.dead).toBe(0)
  })

  it('counts both branches of a choice as distinct reachable states', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'shot', type: 'boolean', defaultValue: 'false' }],
      chapters: [chapter('ch1', 1), chapter('ch2', 2)],
      blocks: [choicePoint('cp1', 'ch1', 0), fragment('frag1', 'ch2', 0)],
      choices: [
        option('c0', 'cp1', 0, 'Duck', { shot: false }),
        option('c1', 'cp1', 1, 'Stand', { shot: true }),
      ],
      overrides: [override('ovA', 'frag1', 1, { shot: true })],
    }))

    // Both states reach the fragment; exactly one satisfies the override.
    const evaluated = report.summary.peakStates
    expect(evaluated).toBe(2)
  })

  // ── The collapse that makes this tractable ─────────────────────────────────

  it('collapses states once no downstream condition reads a variable', () => {
    // Ten independent binary choices would be 1024 states if tracked naively.
    // Nothing reads any of them afterwards, so the frontier must stay tiny.
    const chapters = [chapter('ch0', 0)]
    const blocks = []
    const choices = []
    const variables = []
    for (let i = 0; i < 10; i++) {
      variables.push({ name: `v${i}`, type: 'boolean', defaultValue: 'false' })
      blocks.push(choicePoint(`cp${i}`, 'ch0', i))
      choices.push(option(`c${i}a`, `cp${i}`, 0, 'yes', { [`v${i}`]: true }))
      choices.push(option(`c${i}b`, `cp${i}`, 1, 'no', { [`v${i}`]: false }))
    }
    const report = analyzeReachability(build({ chapters, blocks, choices, variables }))

    // No condition anywhere, so every variable is dead on arrival and the
    // whole fan-out collapses to a single state.
    expect(report.summary.peakStates).toBe(1)
    expect(report.findings.filter(f => f.severity === 'dead')).toEqual([])
  })

  it('treats a bad ending as terminating the run, not continuing it', () => {
    const report = analyzeReachability(build({
      variables: [{ name: 'dead', type: 'boolean', defaultValue: 'false' }],
      chapters: [chapter('ch1', 1), chapter('ch2', 2)],
      blocks: [choicePoint('cp1', 'ch1', 0), fragment('frag1', 'ch2', 0)],
      choices: [
        option('c0', 'cp1', 0, 'Live', { dead: false }),
        { ...option('c1', 'cp1', 1, 'Die', { dead: true }), isBadEnding: true },
      ],
      // Only reachable if a reader carried dead:true forward — they cannot.
      overrides: [override('ov1', 'frag1', 1, { dead: true })],
    }))

    const f = report.findings.find(x => x.id === 'ov1')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('dead')
  })
})

// ── LOOM-155: book gates ─────────────────────────────────────────────────────
//
// Two of the three findings here check THE INVARIANT the non-canon epic rests
// on: the default story state must satisfy every canon book's condition and no
// non-canon book's. Canon is "every variable at its default", which is what the
// canon export walks and what publish ships — so a canon book off the default
// path is exported and published as canon while being unreachable to every
// reader, with no symptom anywhere else in the system.

const gate = (v: boolean) => JSON.stringify({ diverged: v })

/** Books 1-2 ungated, then a fork: canon book 3 vs an alt book. */
const forkedSeries = (opts: {
  canonGate?: string | null
  altGate?: string | null
  altCanon?: boolean
} = {}): ReachabilityInput => ({
  books: [
    { id: 'bk1', title: 'One', order: 1, canon: true },
    { id: 'bk3', title: 'Three', order: 3, canon: true, condition: opts.canonGate ?? gate(false) },
    { id: 'alt', title: 'Undertow', order: 9, canon: opts.altCanon ?? false, condition: opts.altGate ?? gate(true) },
  ],
  chapters: [
    { id: 'ch1', bookId: 'bk1', title: 'Opening', order: 1, condition: null },
    { id: 'ch3', bookId: 'bk3', title: 'Canon road', order: 1, condition: null },
    { id: 'chA', bookId: 'alt', title: 'Other road', order: 1, condition: null },
  ],
  blocks: [choicePoint('cp1', 'ch1', 1)],
  choices: [
    option('opt-stay', 'cp1', 0, 'Stay', { diverged: false }),
    option('opt-go', 'cp1', 1, 'Diverge', { diverged: true }),
  ],
  overrides: [],
  variables: [{ name: 'diverged', type: 'boolean', defaultValue: 'false' }],
})

const kinds = (input: ReachabilityInput) =>
  analyzeReachability(input).findings.map(f => f.kind)

describe('analyzeReachability — book gates', () => {
  it('reports nothing when the gates are authored correctly', () => {
    // The default state (diverged=false) opens canon book 3 and not the alt
    // book. This is the shape every other case below deviates from.
    expect(kinds(forkedSeries())).toEqual([])
  })

  it('flags a canon book the default path never reaches', () => {
    // Gate inverted: canon book 3 now needs diverged=true.
    const report = analyzeReachability(forkedSeries({ canonGate: gate(true), altGate: gate(false) }))
    const f = report.findings.find(x => x.kind === 'canon-book-unreachable')
    expect(f).toBeDefined()
    expect(f!.bookTitle).toBe('Three')
    expect(f!.severity).toBe('dead')
  })

  it('flags a non-canon book sitting on the default path', () => {
    const report = analyzeReachability(forkedSeries({ canonGate: gate(true), altGate: gate(false) }))
    const f = report.findings.find(x => x.kind === 'non-canon-book-in-default-path')
    expect(f).toBeDefined()
    expect(f!.bookTitle).toBe('Undertow')
  })

  it('flags a book no reachable state can open', () => {
    // Nothing sets `diverged` to the string 'maybe', so no reachable state
    // satisfies this — distinct from "off the default path", which at least
    // some reader reaches.
    const report = analyzeReachability(forkedSeries({ altGate: JSON.stringify({ diverged: 'maybe' }) }))
    const f = report.findings.find(x => x.kind === 'book-unreachable')
    expect(f).toBeDefined()
    expect(f!.bookTitle).toBe('Undertow')
    expect(f!.matched).toBe(0)
    expect(f!.evaluated).toBeGreaterThan(0)
  })

  it('flags a gate on an undeclared variable, and says the book is OPEN', () => {
    // The detail matters: isBookVisible returns TRUE for a gate it cannot
    // satisfy-check, so the failure mode is a book visible to everyone rather
    // than a hidden one. A finding that said "hidden" would send the writer
    // looking for the opposite problem.
    const report = analyzeReachability(forkedSeries({ altGate: JSON.stringify({ typoed: true }) }))
    const f = report.findings.find(x => x.targetType === 'book' && x.kind === 'undeclared-variable')
    expect(f).toBeDefined()
    expect(f!.detail).toMatch(/open to everyone/)
  })

  it('counts each book gate once, not once per chapter', () => {
    // Evidence has to be believable: bumping per chapter would inflate
    // `evaluated` by the book's length and make a one-state series look like
    // many.
    const input = forkedSeries()
    input.chapters.push(
      { id: 'ch3b', bookId: 'bk3', title: 'Second', order: 2, condition: null },
      { id: 'ch3c', bookId: 'bk3', title: 'Third', order: 3, condition: null },
    )
    const report = analyzeReachability({ ...input, books: input.books.map(b =>
      b.id === 'bk3' ? { ...b, condition: JSON.stringify({ diverged: 'never' }) } : b) })
    const f = report.findings.find(x => x.kind === 'book-unreachable')
    // Two reachable states reach the fork; the three-chapter book must not
    // multiply that by three.
    expect(f!.evaluated).toBe(2)
  })

  it('ungated books produce no book findings at all', () => {
    const input = forkedSeries()
    const report = analyzeReachability({
      ...input,
      books: input.books.map(b => ({ ...b, condition: null })),
    })
    expect(report.findings.filter(f => f.targetType === 'book')).toEqual([])
  })

  it('counts gated books in the summary', () => {
    expect(analyzeReachability(forkedSeries()).summary.bookGates).toBe(2)
  })
})
