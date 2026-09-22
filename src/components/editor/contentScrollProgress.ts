// Footer progress bar maths for the chapter page.
//
// The naive `scrollTop / (scrollHeight - clientHeight)` reads *viewport*
// progress, not progress through the chapter: collapsing a block deletes
// thousands of pixels from the scroller, so the same reading position
// suddenly counts as much further along. The bar is meant to say "how far
// into the chapter am I", which is a property of the text, not of which
// blocks happen to be folded shut.
//
// So we score against the layout the chapter *would* have with everything
// expanded: every collapsed block contributes back the height it had when it
// was last measured open, both to the total (the denominator) and — for the
// part of it already scrolled past — to the distance travelled.
//
// Height alone isn't enough, though, because collapsing MOVES the writer:
// BlockEditor re-anchors the scroller on the block that was folded, so right
// after a collapse the viewport sits at that block's *top*. Read purely off
// geometry, someone who just folded the first block after reading all of it
// is "at the start of the chapter" — the bar drops to zero, which is the bug
// this file exists to prevent. Hence `passedFraction`: how far into the block
// the writer had got at the moment it folded. While the reading line is still
// inside the resulting stub, that remembered spot is what counts; scrolling
// on through the stub ramps it up to the whole block, so the bar slides
// rather than jumps once they move past content they chose to skip.

export type BlockMetric = {
  /** Offset of the block's top within the scroller's content box. */
  top: number
  /** The block's height as currently laid out. */
  height: number
  /** Height the block had while expanded, if we have ever measured it open. */
  expandedHeight?: number
  /** For a collapsed block: how far into it (0–1) the reader had got when it folded. */
  passedFraction?: number
}

export type ProgressInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  /**
   * Content offset of the line a block is aligned to when scrolled into view
   * — scrollTop plus the blocks' scroll-margin-top, i.e. just under the
   * sticky chapter header. Using it (rather than the raw viewport top) to
   * pick the current block is what makes a collapse land back on the block
   * that was collapsed instead of on the one above it.
   */
  readingLine: number
  /** Every block in the chapter, in document order. */
  blocks: BlockMetric[]
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

// Sub-pixel slack, so a block scrolled exactly into view counts as the one
// the reading line is in rather than as still being below it.
const SLACK = 0.5

/** Is the reading line within this block's box? */
export function holdsReadingLine(b: Pick<BlockMetric, 'top' | 'height'>, readingLine: number): boolean {
  return readingLine >= b.top - SLACK && readingLine < b.top + b.height
}

/** Height a collapsed block is currently hiding. */
function hiddenHeight(b: BlockMetric): number {
  const full = b.expandedHeight
  // Expanded blocks, and collapsed ones we never saw open (so we have no
  // honest number for), hide nothing — they measure themselves.
  if (full == null || full <= b.height) return 0
  return full - b.height
}

/**
 * Hidden height the reading line has passed at `readingLine`, i.e. how much
 * folded-away content is behind it. With `remembered` off it's pure geometry,
 * ignoring collapse anchors — the shape the denominator needs.
 */
function creditedAt(blocks: BlockMetric[], readingLine: number, remembered: boolean): number {
  // The block the reading line is in — the last one starting at or above it.
  let current = blocks.length - 1
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].top > readingLine + SLACK) { current = i - 1; break }
  }
  let credited = 0
  for (let i = 0; i < blocks.length; i++) {
    const d = hiddenHeight(blocks[i])
    if (d === 0) continue
    if (i < current) { credited += d; continue }   // stub is behind us: all of it read
    if (i > current) continue                      // still ahead: none of it
    const b = blocks[i]
    const within = b.height > 0 ? clamp01((readingLine - b.top) / b.height) : 1
    const from = (remembered ? b.passedFraction : undefined) ?? 0
    // Starts at the remembered spot and reaches the whole block by the stub's
    // bottom edge — continuous at both ends, so scrolling never snaps.
    credited += d * (from + (1 - from) * within)
  }
  return credited
}

export function computeContentProgress({
  scrollTop,
  scrollHeight,
  clientHeight,
  readingLine,
  blocks,
}: ProgressInput): number {
  const maxScrollTop = scrollHeight - clientHeight
  // Scale by what this layout can actually reach, not by the whole expanded
  // chapter. The reading line stops one viewport short of the end, so any
  // stub sitting in that last screenful is content it never passes — count
  // its hidden height in the total and the bar can never fill, however far
  // down you scroll. Measuring the same way at the bottom of the scroller
  // makes the two agree there by construction, while still giving collapsed
  // blocks above that point their full height. With nothing collapsed this
  // is just scrollTop / (scrollHeight - clientHeight), as before.
  let reach: number
  if (maxScrollTop > 0) {
    reach = maxScrollTop + creditedAt(blocks, readingLine - scrollTop + maxScrollTop, false)
  } else {
    // Folded so far that the whole chapter fits on screen — there is no
    // scrolling left to measure, so fall back to the expanded chapter's
    // runway and let the collapse anchors say where the writer was.
    let hidden = 0
    for (const b of blocks) hidden += hiddenHeight(b)
    reach = maxScrollTop + hidden
  }
  if (reach <= 0) return 0
  return clamp01((scrollTop + creditedAt(blocks, readingLine, true)) / reach)
}
