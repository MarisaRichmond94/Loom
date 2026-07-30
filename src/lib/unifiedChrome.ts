/**
 * UNIFIED_CHROME flag (KAN-6) — TEMPORARY SCAFFOLDING.
 *
 * Lets the shared Loom/WriteAI palette be compared against the old look
 * side by side, and lets drafting continue in the familiar UI while the new
 * chrome is half-built. With one user there is no staged-rollout value; this
 * exists purely so the design can be judged rather than guessed at.
 *
 * DELETE THIS FILE when KAN-8 closes, along with:
 *   - the [data-chrome="v2"] block in app/globals.css (promote its values
 *     into @theme)
 *   - <ChromeFlagToggle /> and the inline script in app/layout.tsx
 *   - components/ChromeFlagToggle.tsx
 *
 * localStorage is the PRIMARY switch, not the env var. Next.js inlines
 * NEXT_PUBLIC_* at build time and Loom runs a production build under launchd,
 * so flipping the env var appears to do nothing until a rebuild — a genuinely
 * confusing failure mode. The env var only supplies the default for a browser
 * that has never set the key.
 */

export const CHROME_STORAGE_KEY = 'loom-unified-chrome'
export const CHROME_ATTR = 'data-chrome'
export const CHROME_ON = 'v2'

/** Build-time default, used only when localStorage has no opinion yet. */
export const chromeDefaultOn = process.env.NEXT_PUBLIC_UNIFIED_CHROME === 'true'

/**
 * Source for the pre-hydration inline script. Must stay dependency-free and
 * synchronous: it runs in <head> so the correct palette is on <html> before
 * first paint. Without it the old palette would render, then swap — the exact
 * flash the .light-body script pattern avoids.
 */
export function chromeBootScript(defaultOn: boolean): string {
  return `try{var s=localStorage.getItem('${CHROME_STORAGE_KEY}');var on=s===null?${defaultOn}:s==='true';if(on)document.documentElement.setAttribute('${CHROME_ATTR}','${CHROME_ON}');}catch(e){}`
}

export function isUnifiedChromeOn(): boolean {
  if (typeof document === 'undefined') return chromeDefaultOn
  return document.documentElement.getAttribute(CHROME_ATTR) === CHROME_ON
}

/** Flips the flag and applies it immediately — no reload, no rebuild. */
export function toggleUnifiedChrome(): boolean {
  const next = !isUnifiedChromeOn()
  const root = document.documentElement
  if (next) root.setAttribute(CHROME_ATTR, CHROME_ON)
  else root.removeAttribute(CHROME_ATTR)
  try {
    localStorage.setItem(CHROME_STORAGE_KEY, String(next))
  } catch {
    // Private browsing / storage disabled — the attribute still applied, the
    // choice just won't survive a reload. Not worth surfacing.
  }
  return next
}
