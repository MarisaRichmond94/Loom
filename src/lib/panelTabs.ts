// Whether the dock's tab strip can afford text labels (LOOM-41).
//
// SidePanel's own comment notes that three destinations was already past the
// point where icons alone are guessable — a pin and a notebook read as the same
// kind of thing until you have opened both. So labels are not decoration.
//
// But the dock is gaining Events (LOOM-32) and Characters (LOOM-33), and four
// or five labelled tabs do not fit MIN_WIDTH (280px). Rather than raise the
// floor — which permanently narrows the writing column, the thing the floor
// exists to protect — labels are shown when there is room and dropped when
// there is not. Icon-only tabs keep their aria-label and title, so the
// affordance survives; only the always-on hint is lost.

/**
 * Chrome that competes with the tabs for the same row: the header's horizontal
 * padding, the close button, and the status slot where Notes puts "Saving…"
 * and Pins puts "Clear all".
 */
const CHROME_PX = 60

/**
 * Approximate width of one labelled tab — icon, gap, label, padding, and the
 * gap to its neighbour.
 *
 * Tuned so THREE labelled tabs still fit at MIN_WIDTH, which is what the dock
 * does today: collapsing labels at 280px with the current three would be a
 * regression, not this ticket. Four is what stops fitting.
 *
 * These are estimates, not measurements. If the labels or type scale change,
 * re-derive them — the tests below pin the contract (3 fit at the floor, 4 do
 * not) rather than the arithmetic, so they will catch a bad retune.
 */
const LABELLED_TAB_PX = 73

/**
 * Can `tabCount` labelled tabs fit in a dock of `width`?
 *
 * Width-driven rather than count-driven on purpose: the answer stays correct as
 * tabs are added, and it responds to the writer dragging the dock rather than
 * to a hardcoded list.
 */
export function tabsFitLabelled(width: number, tabCount: number): boolean {
  return width >= CHROME_PX + tabCount * LABELLED_TAB_PX
}
