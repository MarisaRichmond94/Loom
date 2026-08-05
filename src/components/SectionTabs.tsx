'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// The book page's section switcher (LOOM-93).
//
// The page stacked full-height sections, so a book with a large cast pushed the
// soundtrack — and anything added below it — off the first screen entirely.
//
// Tabs rather than a stack: only one of these is ever the thing you came for,
// and they are peers, not a sequence. The section headings become the tab
// strip, so nothing new is introduced to the page — the words that were already
// there are now what you click.
//
// The cost, worth being honest about: you can no longer see the cast and the
// soundtrack at once. Nothing on this page related the two, so the loss is
// small, but it is a real one and the collapsible version did not have it.

/**
 * Where a section can put its own header control.
 *
 * `action` on a Section covers the easy case — the page knows the button. It
 * does not cover a section that owns its own data, like the outline: its "Add
 * card" needs the hook that lives INSIDE the section, and lifting that hook to
 * the page would fire the outline's write-on-read GET for every visitor who
 * only came for the cast.
 *
 * So the strip exposes its header slot as a DOM node and the section portals
 * into it. A ref rather than a callback, because passing JSX up through state
 * re-renders the strip on every render of the child.
 */
const SectionActionSlot = createContext<HTMLElement | null>(null)

/** The header node for the active section, or null before the strip mounts. */
export function useSectionActionSlot() {
  return useContext(SectionActionSlot)
}

/** Breathing room left above the tab strip when a click scrolls it into place.
 *  The strip must be VISIBLE at the top, not flush against the edge. */
const STRIP_GAP = 16

export type Section = {
  /** Stable key for the persisted selection. Not the label — a heading is
   *  wording and can be reworded; this is storage. */
  id: string
  label: string
  /** Header control for this section — "Add Character" and the like. Rendered
   *  opposite the strip, and only while its own tab is showing: an Add button
   *  floating beside a list it does not add to is a trap. */
  action?: ReactNode
  content: ReactNode
}

export default function SectionTabs({
  id,
  sections,
  className = 'mb-8',
}: {
  /** Namespace for the persisted selection, so two pages using this do not
   *  fight over one key. */
  id: string
  sections: Section[]
  className?: string
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id)
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** Set by an explicit click, cleared once the scroll is done. Never set on
   *  mount or on the localStorage restore — a page that scrolls itself on load
   *  is worse than one that never scrolls. */
  const pendingScroll = useRef(false)
  const [scrollNonce, setScrollNonce] = useState(0)

  /** The page's own scroller — `<main>` in author/[seriesId]/layout.tsx, not
   *  the window. Found rather than assumed, so this component stays usable if
   *  it is ever mounted somewhere with a different scroll parent. */
  function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
      const overflow = getComputedStyle(n).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return n
    }
    return null
  }

  // ── Why the strip could not reach the top on some tabs ─────────────────────
  //
  // To park the strip at the top of the viewport, the page needs at least a
  // viewport's worth of content BELOW it. Outline's card board is tall enough,
  // so it always worked; the Explore panel is a fixed 560px, so on a tall
  // window there was simply nothing left to scroll and the browser stopped
  // partway — which read as "each tab does this differently".
  //
  // Giving the content area a floor equal to the scroller's own height makes
  // every tab able to do the same thing. Measured rather than guessed at with
  // `100vh`: `<main>` is shorter than the viewport (there is a header above
  // it), so vh units would overshoot and add dead space to every page.
  useEffect(() => {
    const content = contentRef.current
    const strip = stripRef.current
    if (!content || !strip) return
    const scroller = scrollParent(strip)
    if (!scroller) return

    const apply = () => {
      // Everything the strip does NOT occupy once it is parked at the top:
      // the scroller's own height, less the gap above the strip and the strip
      // itself. Without this floor a short section cannot scroll far enough to
      // put the strip up there at all — which is why Outline (a tall card
      // board) was the only tab that ever looked right.
      content.style.minHeight =
        `${Math.max(0, scroller.clientHeight - strip.offsetHeight - STRIP_GAP)}px`
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])

  // ── Why the scroll had to move out of the click handler ───────────────────
  //
  // `select()` ran the scroll synchronously, before React had committed the
  // new section — so it was measured against the OUTGOING tab's layout. Worst
  // on Explore's first click, where the content arrives in three stages: the
  // old section is still mounted when the scroll fires, then the lazy chunk's
  // skeleton, then the panel itself, then the staleness banner once its fetch
  // resolves. Each stage changes the page height and the browser re-clamps.
  //
  // So: scroll after the commit, then re-assert for a short grace window while
  // the section is still settling. The re-assert is instant rather than smooth
  // — a second animation chasing the first is what jitter looks like — and any
  // real scroll by the writer cancels the whole thing, because the moment she
  // takes the wheel she is the one deciding where the page sits.
  useEffect(() => {
    if (!pendingScroll.current) return
    pendingScroll.current = false

    const strip = stripRef.current
    const scroller = strip ? scrollParent(strip) : null
    if (!strip || !scroller) return

    // Measured with rects, NOT `offsetTop`. `offsetTop` is relative to the
    // nearest POSITIONED ancestor, which is not the scroller — so it included
    // the header above `<main>` and overshot by exactly that much, scrolling
    // the strip off the top of the screen instead of to it.
    //
    // This form is independent of where the offsetParent happens to be: how
    // far the strip currently sits below the scroller's top edge is precisely
    // how far the scroller must move to close the gap.
    const target = () => Math.max(
      0,
      scroller.scrollTop
        + strip.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
        - STRIP_GAP,
    )
    scroller.scrollTo({ top: target(), behavior: 'smooth' })

    let cancelled = false
    const release = () => { cancelled = true }
    // `wheel`/`touchmove` rather than `scroll`: our own smooth scroll fires
    // `scroll` events, so listening for those would cancel us immediately.
    scroller.addEventListener('wheel', release, { passive: true })
    scroller.addEventListener('touchmove', release, { passive: true })

    const ro = new ResizeObserver(() => {
      if (cancelled) return
      scroller.scrollTo({ top: target(), behavior: 'auto' })
    })
    if (contentRef.current) ro.observe(contentRef.current)

    const stop = setTimeout(release, 1200)
    return () => {
      clearTimeout(stop)
      ro.disconnect()
      scroller.removeEventListener('wheel', release)
      scroller.removeEventListener('touchmove', release)
    }
  }, [scrollNonce])

  // Read in an effect rather than during render: the server has no
  // localStorage, and seeding state from it directly is a hydration mismatch.
  // Same habit as the dock's tab and width.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`loom-tabs-${id}`)
      // Guarded against a section that no longer exists — a stale key must not
      // leave the page with nothing selected.
      if (saved && sections.some(s => s.id === saved)) setActiveId(saved)
    } catch {
      /* private mode, or storage disabled — first section wins */
    }
    // Deliberately once per page: re-running when `sections` changes identity
    // (it is rebuilt every render) would fight the writer's clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function select(sectionId: string) {
    setActiveId(sectionId)
    try {
      localStorage.setItem(`loom-tabs-${id}`, sectionId)
    } catch {
      /* ignore */
    }
    // Ask for the scroll; the effect below performs it AFTER the new section
    // has laid out. Doing it here ran against the OLD layout — see the effect.
    pendingScroll.current = true
    setScrollNonce(n => n + 1)
  }

  const active = sections.find(s => s.id === activeId) ?? sections[0]

  return (
    <div className={className}>
      <div
        ref={stripRef}
        className="scroll-mt-4 flex items-center justify-between mb-2 border-b border-accent/10"
      >
        {/* Spacing lives in the gap, not in each tab's padding: the underline
            is only as wide as its label, so padding would stretch the marker
            away from the word it marks. */}
        <div role="tablist" className="flex items-center gap-6">
          {sections.map(s => {
            const isActive = s.id === active?.id
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => select(s.id)}
                // The underline sits on the same line as the strip's own
                // border, so the active tab reads as connected to its content
                // rather than as a chip floating above it.
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-semibold uppercase tracking-widest transition ${
                  isActive
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-faint hover:text-ink-muted'
                }`}
              >
                {/* No count. A tab strip is a place to go, and a number on it
                    is answering a question nobody asked on the way there — the
                    list itself says how long it is once you arrive. */}
                {s.label}
              </button>
            )
          })}
        </div>
        {/* Both routes into this slot land in the same place, so a page-owned
            action and a section-owned one are indistinguishable on screen. */}
        <div ref={setActionSlot} className="flex items-center gap-2 pb-2">
          {active?.action}
        </div>
      </div>

      {/* Only the active section is mounted. These carry <img> and <audio>
          elements, and a section nobody is looking at should not be fetching
          portraits and album art. */}
      <div ref={contentRef}>
        <SectionActionSlot.Provider value={actionSlot}>{active?.content}</SectionActionSlot.Provider>
      </div>
    </div>
  )
}
