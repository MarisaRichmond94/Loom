import { computeContentProgress, holdsReadingLine, type BlockMetric } from '@/components/editor/contentScrollProgress'

// The chapter footer bar must track progress through the CHAPTER, not through
// the scroller: collapsing a block shortens the scroller without removing a
// word of prose, and it also re-anchors the view onto the folded block. The
// bar must not lurch backwards because of either.
//
// These tests drive a small model of the real page — the same layout, the
// same scrollIntoView({block:'nearest'}) re-anchoring BlockEditor does, and
// the same "forget the anchor once the reading line leaves the stub" rule the
// chapter page applies after every reading.

const CLIENT = 500      // viewport height
const MARGIN = 100      // [data-block-id]'s scroll-margin-top
const OPEN = 1000       // height of an expanded block
const STUB = 40         // height of a collapsed one
const COUNT = 4         // a 4000px chapter: each block is a quarter of it

type Sim = { scrollTop: number; collapsed: Set<number>; anchors: Map<number, number> }

const newSim = (scrollTop = 0): Sim => ({ scrollTop, collapsed: new Set(), anchors: new Map() })

function layout(sim: Sim) {
  let top = 0
  const blocks = Array.from({ length: COUNT }, (_, i) => {
    const height = sim.collapsed.has(i) ? STUB : OPEN
    const b: BlockMetric & { id: number } = {
      id: i,
      top,
      height,
      expandedHeight: OPEN,
      passedFraction: sim.collapsed.has(i) ? sim.anchors.get(i) : undefined,
    }
    top += height
    return b
  })
  return { blocks, scrollHeight: top, maxScroll: Math.max(0, top - CLIENT) }
}

/** One bar reading, plus the page's anchor-forgetting side effect. */
function read(sim: Sim): number {
  const { blocks, scrollHeight } = layout(sim)
  const readingLine = sim.scrollTop + MARGIN
  const p = computeContentProgress({ scrollTop: sim.scrollTop, scrollHeight, clientHeight: CLIENT, readingLine, blocks })
  for (const b of blocks) {
    if (b.passedFraction != null && !holdsReadingLine(b, readingLine)) sim.anchors.delete(b.id)
  }
  return p
}

function scrollTo(sim: Sim, scrollTop: number): number {
  sim.scrollTop = Math.min(layout(sim).maxScroll, Math.max(0, scrollTop))
  return read(sim)
}

/** Collapse block i the way the page does: bank the anchor, then re-anchor. */
function collapse(sim: Sim, i: number): number {
  const before = layout(sim).blocks[i]
  const line = sim.scrollTop + MARGIN
  sim.collapsed.add(i)
  sim.anchors.set(i, Math.min(1, Math.max(0, (line - before.top) / before.height)))
  // scrollIntoView({ block: 'nearest' }) against the post-collapse layout.
  const after = layout(sim)
  const b = after.blocks[i]
  if (b.top - MARGIN < sim.scrollTop) sim.scrollTop = b.top - MARGIN
  else if (b.top + b.height > sim.scrollTop + CLIENT) sim.scrollTop = b.top + b.height - CLIENT
  sim.scrollTop = Math.min(after.maxScroll, Math.max(0, sim.scrollTop))
  return read(sim)
}

test('expanded chapter scores plain scroll progress', () => {
  const sim = newSim()
  expect(read(sim)).toBe(0)
  expect(scrollTo(sim, 1750)).toBeCloseTo(0.5)   // halfway down a 3500px runway
  expect(scrollTo(sim, 99999)).toBe(1)
})

test('collapsing the first block after reading it does not send the bar to zero', () => {
  // Marisa's report: at the bottom of a long first block, fold it shut. The
  // view is re-anchored to the top of the chapter, but the block's text has
  // still been read — the bar must not read 0.
  const sim = newSim()
  scrollTo(sim, OPEN - CLIENT)
  expect(collapse(sim, 0)).toBeGreaterThan(0.2)
  // ...and it stays put when nothing moves.
  expect(read(sim)).toBeGreaterThan(0.2)
})

test('collapsing the block being read leaves the bar where it was', () => {
  const sim = newSim()
  const before = scrollTo(sim, 2400)              // partway into block 2
  expect(collapse(sim, 2)).toBeCloseTo(before, 1)
})

test('collapsing the block starting below the reader leaves the bar where it was', () => {
  // The next block down, its top just inside the viewport — folding it is a
  // no-op for the view (a stub that short stays visible, so 'nearest' doesn't
  // scroll) and must be a no-op for the bar. A block entirely off-screen
  // isn't modelled: its chevron can't be clicked, so it can't be toggled.
  const sim = newSim()
  const before = scrollTo(sim, OPEN - 100)
  expect(collapse(sim, 1)).toBeCloseTo(before, 5)
})

test('a folded chapter still runs 0 to 1, and the bar never goes backwards', () => {
  const sim = newSim()
  scrollTo(sim, 2400)
  collapse(sim, 2)
  let last = read(sim)
  for (let s = sim.scrollTop; s <= layout(sim).maxScroll; s += 20) {
    const p = scrollTo(sim, s)
    expect(p).toBeGreaterThanOrEqual(last - 1e-9)
    last = p
  }
  expect(scrollTo(sim, 99999)).toBe(1)
})

test('collapse-all keeps the reader somewhere sane rather than at zero', () => {
  // ⌥⇧9 sets the whole collapsed set at once and never re-anchors; the
  // scroller just clamps to its new, much shorter, maximum.
  const sim = newSim()
  scrollTo(sim, 3000)                             // deep in the last block
  const line = sim.scrollTop + MARGIN
  const open = layout(sim).blocks
  for (let i = 0; i < COUNT; i++) {
    sim.collapsed.add(i)
    sim.anchors.set(i, Math.min(1, Math.max(0, (line - open[i].top) / open[i].height)))
  }
  sim.scrollTop = Math.min(layout(sim).maxScroll, sim.scrollTop)
  expect(read(sim)).toBeGreaterThan(0.5)
})

test('the bar fills at the bottom with a stub in the last screenful', () => {
  // The reading line stops a viewport short of the end, so it never passes a
  // stub down there — but the writer has still reached the bottom.
  for (const folded of [COUNT - 1, COUNT - 2]) {
    const sim = newSim()
    scrollTo(sim, folded * OPEN + 100)
    collapse(sim, folded)
    expect(scrollTo(sim, 99999)).toBe(1)
  }
})

test('a block never seen expanded contributes only its real height', () => {
  const blocks: BlockMetric[] = [
    { top: 0, height: OPEN, expandedHeight: OPEN },
    { top: OPEN, height: STUB },
  ]
  const scrollHeight = OPEN + STUB
  const scrollTop = scrollHeight - CLIENT
  expect(computeContentProgress({ scrollTop, scrollHeight, clientHeight: CLIENT, readingLine: scrollTop + MARGIN, blocks })).toBe(1)
})

test('progress stays in range when the scroller is shorter than the viewport', () => {
  const blocks: BlockMetric[] = [{ top: 0, height: 300, expandedHeight: 300 }]
  expect(computeContentProgress({ scrollTop: 0, scrollHeight: 300, clientHeight: CLIENT, readingLine: MARGIN, blocks })).toBe(0)
})
