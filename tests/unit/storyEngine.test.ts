import { resolveConditional, applyChoice, rewindTo, matchesCondition } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry, ConditionalBlock, ChoiceRecord, Condition } from '@/lib/storyEngine'

const OVR_A = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"override-a"}]}]}'
const OVR_B = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"override-b"}]}]}'

function makeBlock(overrides: ConditionalBlock['overrides'] = []): ConditionalBlock {
  return { overrides }
}

describe('resolveConditional', () => {
  it('returns null when state is empty', () => {
    expect(resolveConditional(makeBlock(), {})).toBe(null)
  })

  it('returns null when no override condition matches', () => {
    const block = makeBlock([{ id: 'o1', order: 1, condition: { spare_victim: true }, content: OVR_A }])
    expect(resolveConditional(block, { spare_victim: false })).toBe(null)
  })

  it('returns override content when condition matches', () => {
    const block = makeBlock([{ id: 'o1', order: 1, condition: { spare_victim: true }, content: OVR_A }])
    expect(resolveConditional(block, { spare_victim: true })).toBe(OVR_A)
  })

  it('picks first matching override by order when multiple match', () => {
    const block = makeBlock([
      { id: 'o1', order: 1, condition: { spare_victim: true }, content: OVR_A },
      { id: 'o2', order: 2, condition: { spare_victim: true }, content: OVR_B },
    ])
    expect(resolveConditional(block, { spare_victim: true })).toBe(OVR_A)
  })

  it('requires all condition keys to match', () => {
    const block = makeBlock([
      { id: 'o1', order: 1, condition: { spare_victim: true, burned_letter: true }, content: OVR_A },
    ])
    expect(resolveConditional(block, { spare_victim: true, burned_letter: false })).toBe(null)
    expect(resolveConditional(block, { spare_victim: true, burned_letter: true })).toBe(OVR_A)
  })
})

describe('matchesCondition — number comparisons', () => {
  // A comparison clause only exists in the compound shape (the legacy
  // { var: value } form has no slot for an operator).
  const gate = (cmp: string, value: number): Condition =>
    ({ op: 'and', clauses: [{ var: 'trust', value, cmp: cmp as never }] })

  it('legacy equality (absent cmp) is unchanged', () => {
    expect(matchesCondition({ trust: 3 }, { trust: 3 })).toBe(true)
    expect(matchesCondition({ trust: 3 }, { trust: 4 })).toBe(false)
  })

  it('a compound clause with no cmp defaults to equality', () => {
    const c: Condition = { op: 'and', clauses: [{ var: 'trust', value: 3 }] }
    expect(matchesCondition(c, { trust: 3 })).toBe(true)
    expect(matchesCondition(c, { trust: 2 })).toBe(false)
  })

  it('> is strict', () => {
    expect(matchesCondition(gate('>', 5), { trust: 6 })).toBe(true)
    expect(matchesCondition(gate('>', 5), { trust: 5 })).toBe(false)
    expect(matchesCondition(gate('>', 5), { trust: 4 })).toBe(false)
  })

  it('>= includes the boundary', () => {
    expect(matchesCondition(gate('>=', 5), { trust: 5 })).toBe(true)
    expect(matchesCondition(gate('>=', 5), { trust: 4 })).toBe(false)
  })

  it('< and <= behave symmetrically', () => {
    expect(matchesCondition(gate('<', 5), { trust: 4 })).toBe(true)
    expect(matchesCondition(gate('<', 5), { trust: 5 })).toBe(false)
    expect(matchesCondition(gate('<=', 5), { trust: 5 })).toBe(true)
    expect(matchesCondition(gate('<=', 5), { trust: 6 })).toBe(false)
  })

  it('fails (does not throw) when the variable is unset or non-numeric', () => {
    expect(matchesCondition(gate('>', 5), {})).toBe(false)
    expect(matchesCondition(gate('>', 5), { trust: 'high' })).toBe(false)
  })

  it('composes with AND and OR across mixed clauses', () => {
    const andGate: Condition = { op: 'and', clauses: [
      { var: 'trust', value: 5, cmp: '>' },
      { var: 'brave', value: true },
    ] }
    expect(matchesCondition(andGate, { trust: 6, brave: true })).toBe(true)
    expect(matchesCondition(andGate, { trust: 6, brave: false })).toBe(false)
    expect(matchesCondition(andGate, { trust: 5, brave: true })).toBe(false)

    const orGate: Condition = { op: 'or', clauses: [
      { var: 'trust', value: 10, cmp: '>=' },
      { var: 'gold', value: 0, cmp: '>' },
    ] }
    expect(matchesCondition(orGate, { trust: 2, gold: 1 })).toBe(true)
    expect(matchesCondition(orGate, { trust: 2, gold: 0 })).toBe(false)
  })
})

describe('applyChoice', () => {
  const choice: ChoiceRecord = { id: 'c1', setsVariables: { spare_victim: true }, targetChapterId: null }

  it('merges setsVariables into state', () => {
    const { newState } = applyChoice({ spare_victim: false }, [], 'cp1', choice)
    expect(newState.spare_victim).toBe(true)
  })

  it('preserves unrelated state keys', () => {
    const { newState } = applyChoice({ burned_letter: false, spare_victim: false }, [], 'cp1', choice)
    expect(newState.burned_letter).toBe(false)
  })

  it('does not mutate original state', () => {
    const state: StoryState = { spare_victim: false }
    applyChoice(state, [], 'cp1', choice)
    expect(state.spare_victim).toBe(false)
  })

  it('appends history entry with pre-choice snapshot', () => {
    const { newHistory } = applyChoice({ spare_victim: false }, [], 'cp1', choice)
    expect(newHistory).toHaveLength(1)
    expect(newHistory[0]).toEqual({
      choicePointId: 'cp1',
      choiceId: 'c1',
      stateSnapshot: { spare_victim: false },
    })
  })

  it('does not mutate original history array', () => {
    const existing: HistoryEntry[] = [{ choicePointId: 'cp0', choiceId: 'c0', stateSnapshot: {} }]
    applyChoice({}, existing, 'cp1', choice)
    expect(existing).toHaveLength(1)
  })
})

describe('rewindTo', () => {
  const history: HistoryEntry[] = [
    { choicePointId: 'cp1', choiceId: 'c1', stateSnapshot: {} },
    { choicePointId: 'cp2', choiceId: 'c2', stateSnapshot: { spare_victim: true } },
    { choicePointId: 'cp3', choiceId: 'c3', stateSnapshot: { spare_victim: true, burned_letter: false } },
  ]

  it('restores stateSnapshot from the rewound entry', () => {
    const { restoredState } = rewindTo(history, 'cp2')
    expect(restoredState).toEqual({ spare_victim: true })
  })

  it('truncates history to entries before the rewound entry', () => {
    const { truncatedHistory } = rewindTo(history, 'cp2')
    expect(truncatedHistory).toHaveLength(1)
    expect(truncatedHistory[0].choicePointId).toBe('cp1')
  })

  it('handles rewinding to the first choice', () => {
    const { restoredState, truncatedHistory } = rewindTo(history, 'cp1')
    expect(restoredState).toEqual({})
    expect(truncatedHistory).toHaveLength(0)
  })

  it('throws when choicePointId is not in history', () => {
    expect(() => rewindTo(history, 'nonexistent')).toThrow('not found in history')
  })
})
