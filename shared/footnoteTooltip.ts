/**
 * Keeps the footnote hover tooltip (`.footnote-ref::after`, styled in
 * prose.css) inside the viewport horizontally.
 *
 * The tooltip is a CSS `::after` pseudo-element centered on its anchor via
 * `left: 50%; transform: translateX(-50%)`. That positioning has no way to
 * know where the anchor sits relative to the viewport, so an anchor near
 * either edge pushes the (up to 260px wide) box off-screen. This measures
 * the anchor on hover and writes the correction as a CSS variable that the
 * pseudo-element's transform reads — cheaper than replacing the tooltip
 * with a JS-positioned popover, and it keeps working wherever footnotes
 * render (editor, reader, review panel, ...) without per-surface wiring.
 */
const TOOLTIP_WIDTH = 260
const MARGIN = 8

export function attachFootnoteTooltipClamp(): () => void {
  function onOver(e: MouseEvent) {
    const el = (e.target as Element | null)?.closest?.('.footnote-ref')
    if (!(el instanceof HTMLElement)) return
    const rect = el.getBoundingClientRect()
    const center = rect.left + rect.width / 2
    const halfWidth = TOOLTIP_WIDTH / 2
    const minCenter = halfWidth + MARGIN
    const maxCenter = window.innerWidth - halfWidth - MARGIN
    const clamped = Math.min(Math.max(center, minCenter), maxCenter)
    el.style.setProperty('--footnote-shift', `${clamped - center}px`)
  }
  document.addEventListener('mouseover', onOver)
  return () => document.removeEventListener('mouseover', onOver)
}
