/**
 * Where portalled overlays belong (LOOM-32 / LOOM-33).
 *
 * `<main>`, not `<body>`, and both halves matter:
 *
 *   * The dock is `relative z-30`, which makes it a stacking context. A
 *     `fixed` child cannot outrank a sibling of its own context however high
 *     its z-index — which is why a modal rendered inside the dock lost to the
 *     chapter header. Portalling out of the dock fixes that.
 *   * `.light-body` — the class that carries light mode — lives on <main>,
 *     not on <html>. Portalling all the way to <body> escapes the theme along
 *     with the stacking context, and renders a dark modal over a light page.
 *
 * <main> is an ancestor of the dock and only sets overflow, which neither
 * clips nor re-anchors a fixed child, so it satisfies both.
 */
export function portalHost(): Element {
  return (typeof document !== 'undefined' && document.querySelector('main')) || document.body
}
