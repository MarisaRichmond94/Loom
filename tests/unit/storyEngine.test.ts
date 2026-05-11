import { resolveConditional, applyChoice, rewindTo } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry, ConditionalBlock, ChoiceRecord } from '@/lib/storyEngine'

const BASE = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"base"}]}]}'
const OVR_A = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"override-a"}]}]}'
const OVR_B = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"override-b"}]}]}'

function makeBlock(overrides: ConditionalBlock['overrides'] = []): ConditionalBlock {
  return { baseContent: BASE, overrides }
}

describe('resolveConditional', () => {
  it('returns baseContent when state is empty', () => {
    expect(resolveConditional(makeBlock(), {})).toBe(BASE)
  })

  it('returns baseContent when no override condition matches', () => {
    const block = makeBlock([{ id: 'o1', order: 1, condition: { spare_victim: true }, content: OVR_A }])
    expect(resolveConditional(block, { spare_victim: false })).toBe(BASE)
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
    expect(resolveConditional(block, { spare_victim: true, burned_letter: false })).toBe(BASE)
    expect(resolveConditional(block, { spare_victim: true, burned_letter: true })).toBe(OVR_A)
  })
})

describe('applyChoice', () => {
  const choice: ChoiceRecord = { id: 'c1', setsVariables: { spare_victim: true }, targetSceneId: null }

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
