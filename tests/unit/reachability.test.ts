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
