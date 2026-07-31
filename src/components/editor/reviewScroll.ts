// Where the review panel should scroll to while a reply streams in.
//
// Pulled out as pure arithmetic because the behaviour it encodes is precise
// and easy to get subtly wrong: follow the reply, but only until its first
// line reaches the top of the panel, then stop and let it fill downward.
//
// The two obvious behaviours are both wrong. Pinning to the bottom drags the
// writer past text she has not read at a speed nobody reads at. Not moving at
// all leaves the reply growing off the bottom edge while she looks at the
// question she already knows she asked.
//
// The trick is that the target is FIXED — the top of the response — not the
// end of the text. Early on the scroller cannot reach it, because there is not
// yet enough content below to scroll that far, so it creeps up as the reply
// grows. The moment it can reach it, it stops: later chunks change
// scrollHeight but not the target.

export type FollowScrollInput = {
  /** Offset of the response's top within the scroller's content. */
  targetTop: number
  /** Where the scroller is now. */
  scrollTop: number
  /** Total scrollable content height. */
  scrollHeight: number
  /** Visible height of the scroller. */
  clientHeight: number
}

/**
 * Returns the scrollTop to move to, or `null` to leave the view alone.
 *
 * Never returns a position earlier than the current one. A partial markdown
 * token can re-flow and briefly shorten the rendered reply; without that guard
 * the view would tug backwards mid-stream.
 */
export function followScrollTop({
  targetTop,
  scrollTop,
  scrollHeight,
  clientHeight,
}: FollowScrollInput): number | null {
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const next = Math.min(Math.max(0, targetTop), maxScroll)
  return next > scrollTop ? next : null
}
