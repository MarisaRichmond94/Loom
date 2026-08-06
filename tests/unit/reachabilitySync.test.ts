import {
  affectsReachability,
  notifyReachabilityChanged,
  subscribeReachabilityChanged,
} from '@/lib/reachabilitySync'

// What re-checks a reachability warning, and what must not (LOOM-122).
//
// Two failure modes, opposite and both bad:
//
//   - Too narrow: the writer removes the clause that made a branch dead, the
//     warning stays, and she concludes the checker is wrong. A stale
//     correctness tool is worse than none.
//   - Too broad: prose saves fire on a keystroke debounce, so treating them as
//     structural would re-walk the whole series continuously while she types.
//
// The filter below is the line between them, so it is pinned by name.

describe('affectsReachability', () => {
  it.each([
    ['condition', { condition: '{"a":true}' }],
    ['setsVariables', { setsVariables: '{"a":true}' }],
    ['isBadEnding', { isBadEnding: true }],
    ['endsChapter', { endsChapter: true }],
    ['order', { order: 3 }],
    ['numbered', { numbered: false }],
  ])('re-checks when %s changes', (_name, payload) => {
    expect(affectsReachability(payload)).toBe(true)
  })

  it.each([
    ['content', { content: '{"type":"doc"}' }],
    ['baseContent', { baseContent: '{"type":"doc"}' }],
    ['prompt', { prompt: 'What now?' }],
    ['endingMessage', { endingMessage: 'You died.' }],
  ])('ignores %s — prose cannot change what is reachable', (_name, payload) => {
    expect(affectsReachability(payload)).toBe(false)
  })

  it('re-checks a mixed payload that touches anything structural', () => {
    expect(affectsReachability({ content: 'x', condition: '{"a":1}' })).toBe(true)
  })

  it('ignores an empty payload', () => {
    expect(affectsReachability({})).toBe(false)
  })
})

describe('subscribeReachabilityChanged', () => {
  it('notifies every subscriber', () => {
    const a = jest.fn()
    const b = jest.fn()
    const offA = subscribeReachabilityChanged(a)
    const offB = subscribeReachabilityChanged(b)

    notifyReachabilityChanged()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA(); offB()
  })

  it('stops notifying after unsubscribe, so an unmounted panel cannot set state', () => {
    const cb = jest.fn()
    const off = subscribeReachabilityChanged(cb)
    off()

    notifyReachabilityChanged()

    expect(cb).not.toHaveBeenCalled()
  })

  it('keeps going when one subscriber throws', () => {
    const bad = jest.fn(() => { throw new Error('boom') })
    const good = jest.fn()
    const offBad = subscribeReachabilityChanged(bad)
    const offGood = subscribeReachabilityChanged(good)

    expect(() => notifyReachabilityChanged()).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    offBad(); offGood()
  })
})
