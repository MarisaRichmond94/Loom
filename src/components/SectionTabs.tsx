'use client'

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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

export type Section = {
  /** Stable key for the active tab. Not the label — a heading is wording and
   *  can be reworded; this is identity. */
  id: string
  label: string
  /** Header control for this section — "Add Character" and the like. Rendered
   *  opposite the strip, and only while its own tab is showing: an Add button
   *  floating beside a list it does not add to is a trap. */
  action?: ReactNode
  content: ReactNode
}

export default function SectionTabs({
  sections,
  className = 'mb-8',
  initialId,
}: {
  sections: Section[]
  className?: string
  /**
   * Tab to open on mount, instead of the first one.
   *
   * Deliberately a prop driven by an explicit link, not a remembered "last
   * tab" — LOOM-111 made this page always open on its first tab, and that
   * stands: arriving at the series page should be predictable. This is the
   * different case of arriving with a stated destination, the way the chapter
   * banner's "Show all issues" does.
   *
   * An id that matches no section falls back to the first, so a stale or
   * mistyped link lands somewhere real rather than on an empty page.
   */
  initialId?: string
}) {
  const [activeId, setActiveId] = useState(
    initialId && sections.some(s => s.id === initialId) ? initialId : sections[0]?.id,
  )
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** Content height right before a tab switch, so the swap can animate FROM
   *  it. Null until the first switch — the initial mount has no "before". */
  const prevHeightRef = useRef<number | null>(null)
  /** Scroll position right before a tab switch, so it can be held in place
   *  while the new section's own data arrives. Same null-until-first-switch
   *  rule as the height above. */
  const prevScrollTopRef = useRef<number | null>(null)

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

  // ── Why tab switches animate height instead of snapping ────────────────────
  //
  // The content div swaps its child synchronously on click — the outgoing
  // section unmounts and the next one mounts in the same commit. Without this
  // effect, the page's scrollHeight collapses or grows in that same instant —
  // a visible jolt even though the scroll position itself is left alone.
  //
  // Pinning the OLD height the instant the new content lands, then animating
  // to the new one, turns that into a smooth resize instead. Pixel heights
  // rather than the grid-template-rows 0fr→1fr trick used elsewhere
  // (EventsPanel, CharactersPanel): that trick needs a known boolean target,
  // and here the target is whatever the next section's natural height is.
  useLayoutEffect(() => {
    const content = contentRef.current
    const prev = prevHeightRef.current
    if (!content || prev == null) return

    const next = content.getBoundingClientRect().height
    content.style.height = `${prev}px`
    content.style.overflow = 'hidden'
    // Forces the pinned height to land in its own paint. Without this the
    // browser coalesces it with the next line and there is nothing to
    // animate FROM.
    void content.offsetHeight
    const raf = requestAnimationFrame(() => {
      content.style.height = `${next}px`
    })

    const release = () => {
      content.style.height = ''
      content.style.overflow = ''
    }
    // Matches the div's `duration-200` below, plus a small margin.
    const timer = setTimeout(release, 240)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      release()
    }
  }, [activeId])

  // ── Why scroll position needs holding, not just the height pin above ──────
  //
  // The height pin only covers the SYNCHRONOUS part of a tab switch — the
  // moment the old section unmounts and the new one mounts. Outline and
  // Explore both fetch their own data on mount (deliberately — see
  // useBookOutline and ExplorePanel's own comments) rather than having it
  // ready at the page level like Characters or Soundtrack. So their content
  // renders small (or empty) first and pops in taller once that fetch
  // resolves, well after the height pin's short window has already released.
  //
  // When the page shrinks in between, the browser clamps scrollTop down to
  // fit — and does not put it back once the content grows again. That clamp,
  // not any deliberate scroll call, is what reads as "jumped to the top".
  //
  // So: hold the pre-switch scrollTop for as long as this section's content
  // keeps resizing, and stop only when the writer scrolls on her own or the
  // outer bound below is hit — same cancel-on-input rule as any other
  // scroll-preserving effect, because the instant she takes the wheel she is
  // the one deciding where the page sits.
  //
  // Deliberately NOT released on a "no resize for Nms" quiet timer. That was
  // tried and is exactly what let the jump back in: a slow fetch (WriteAI
  // calls routinely clear 400ms, prefetched or not) leaves a gap with no
  // resize, the quiet timer fires and gives up, and the ResizeObserver KEEPS
  // OBSERVING but its callback silently no-ops from then on — so the resize
  // that actually mattered, the one when the real data finally lands, goes
  // uncorrected. Holding all the way to the outer bound costs nothing when
  // nothing resizes late; it only matters for exactly the case this effect
  // exists for.
  useLayoutEffect(() => {
    const content = contentRef.current
    const target = prevScrollTopRef.current
    if (!content || target == null) return
    const scroller = scrollParent(content)
    if (!scroller) return

    let cancelled = false
    const release = () => { cancelled = true }
    scroller.addEventListener('wheel', release, { passive: true })
    scroller.addEventListener('touchmove', release, { passive: true })

    const ro = new ResizeObserver(() => {
      if (cancelled) return
      scroller.scrollTop = target
    })
    ro.observe(content)
    scroller.scrollTop = target

    // Outer bound in case something keeps resizing indefinitely — holding
    // scroll hostage past a few seconds would be worse than the jump this
    // effect exists to prevent.
    const stop = setTimeout(release, 4000)
    return () => {
      cancelled = true
      clearTimeout(stop)
      ro.disconnect()
      scroller.removeEventListener('wheel', release)
      scroller.removeEventListener('touchmove', release)
    }
  }, [activeId])

  function select(sectionId: string) {
    if (contentRef.current) {
      prevHeightRef.current = contentRef.current.getBoundingClientRect().height
      const scroller = scrollParent(contentRef.current)
      prevScrollTopRef.current = scroller?.scrollTop ?? null
    }
    setActiveId(sectionId)
  }

  const active = sections.find(s => s.id === activeId) ?? sections[0]

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2 border-b border-accent/10">
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
      <div ref={contentRef} className="transition-[height] duration-200 ease-out motion-reduce:transition-none">
        <SectionActionSlot.Provider value={actionSlot}>{active?.content}</SectionActionSlot.Provider>
      </div>
    </div>
  )
}
