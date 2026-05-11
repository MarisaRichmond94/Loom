import { buildInitialState, serializeSession, deserializeSession } from '@/lib/sessionService'

describe('buildInitialState', () => {
  it('returns empty object when no variables defined', () => {
    expect(buildInitialState([])).toEqual({})
  })

  it('maps each variable to its decoded defaultValue', () => {
    const variables = [
      { id: '1', name: 'spare_victim', type: 'boolean', defaultValue: 'false' },
      { id: '2', name: 'kill_count', type: 'number', defaultValue: '0' },
      { id: '3', name: 'path', type: 'string', defaultValue: '"north"' },
    ]
    expect(buildInitialState(variables)).toEqual({
      spare_victim: false,
      kill_count: 0,
      path: 'north',
    })
  })
})

describe('serializeSession / deserializeSession', () => {
  it('round-trips storyState and choiceHistory through JSON strings', () => {
    const state = { spare_victim: true, kill_count: 2 }
    const history = [{ choicePointId: 'cp1', choiceId: 'c1', stateSnapshot: {} }]
    const serialized = serializeSession(state, history)
    const deserialized = deserializeSession(serialized.storyState, serialized.choiceHistory)
    expect(deserialized.storyState).toEqual(state)
    expect(deserialized.choiceHistory).toEqual(history)
  })
})
