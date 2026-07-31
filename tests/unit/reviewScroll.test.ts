import { followScrollTop } from '@/components/editor/reviewScroll'

// The requested behaviour, stated as a simulation: as a reply streams in, the
// panel should creep upward until the response's first line reaches the top,
// and then hold still while the rest fills in beneath it.
//
// Note these do not currently run via `npm test` (KAN-29); they were verified
// by compiling the module and asserting against it directly.

const CLIENT = 600     // visible height of the panel
const TARGET = 300     // the response starts 300px into the content

/** Streams a reply in, returning the scroll position after each chunk. */
function simulate(chunks: number, opts: { targetTop?: number } = {}) {
  const targetTop = opts.targetTop ?? TARGET
  let scrollTop = 0
  const positions: number[] = []
  for (let i = 1; i <= chunks; i++) {
    // Content grows below the response as text arrives.
    const scrollHeight = targetTop + i * 120
    const next = followScrollTop({ targetTop, scrollTop, scrollHeight, clientHeight: CLIENT })
    if (next !== null) scrollTop = next
    positions.push(scrollTop)
  }
  return positions
}

describe('followScrollTop', () => {
  it('does not move while there is nothing to scroll', () => {
    expect(followScrollTop({
      targetTop: TARGET, scrollTop: 0, scrollHeight: 400, clientHeight: CLIENT,
    })).toBeNull()
  })

  it('creeps upward while the target is still out of reach', () => {
    const p = simulate(4)
    // Strictly increasing, and never past the target.
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1])
    expect(Math.max(...p)).toBeLessThanOrEqual(TARGET)
  })

  it('stops once the response reaches the top, and stays there', () => {
    const p = simulate(20)
    expect(p[p.length - 1]).toBe(TARGET)
    // Having arrived, later chunks must not move it at all.
    const settled = p.slice(p.indexOf(TARGET))
    expect(new Set(settled).size).toBe(1)
  })

  it('never scrolls backwards when the rendered reply briefly shrinks', () => {
    // A partial markdown token can re-flow shorter between chunks.
    expect(followScrollTop({
      targetTop: TARGET, scrollTop: TARGET, scrollHeight: 700, clientHeight: CLIENT,
    })).toBeNull()
  })

  it('clamps to what is actually scrollable', () => {
    const next = followScrollTop({
      targetTop: TARGET, scrollTop: 0, scrollHeight: 700, clientHeight: CLIENT,
    })
    expect(next).toBe(100) // 700 - 600, not the 300 target
  })

  it('treats a response already at the top as nothing to do', () => {
    expect(followScrollTop({
      targetTop: 0, scrollTop: 0, scrollHeight: 5000, clientHeight: CLIENT,
    })).toBeNull()
  })

  it('never returns a negative position', () => {
    const next = followScrollTop({
      targetTop: -20, scrollTop: 0, scrollHeight: 5000, clientHeight: CLIENT,
    })
    expect(next).toBeNull()
  })
})
