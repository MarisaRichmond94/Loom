'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { LuChevronDown } from 'react-icons/lu'

// A book-page section that collapses and caps its own height (LOOM-93).
//
// The page stacks full-height sections, so a book with a large cast pushed the
// soundtrack — and anything below it — off the first screen entirely. Rather
// than paginate or truncate, each section keeps its own scroller: everything is
// still there, and the page stays navigable as sections are added.
//
// One component rather than three copies. The caps differ only by a number, and
// three hand-rolled versions would drift the moment one of them grew a header
// control.

/**
 * Collapse state, persisted per section.
 *
 * A section you collapsed should stay collapsed on the next visit — re-expanding
 * on every load defeats the point of collapsing it. Same `localStorage` habit as
 * the dock's tab and width.
 *
 * Read in an effect rather than during render: the server has no localStorage,
 * so seeding state from it directly is a hydration mismatch. The cost is that a
 * collapsed section renders open for one frame.
 */
function useCollapsed(id: string) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(`loom-section-${id}`) === 'collapsed')
    } catch {
      /* private mode, or storage disabled — default open */
    }
  }, [id])

  function toggle() {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(`loom-section-${id}`, next ? 'collapsed' : 'open')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return [collapsed, toggle] as const
}

export default function CollapsibleSection({
  id,
  title,
  count,
  maxHeight,
  action,
  className = 'mb-4',
  children,
}: {
  /** Stable key for the persisted collapse state. Not the title — a heading is
   *  wording and can be reworded; this is storage. */
  id: string
  title: string
  /** Shown beside the title. The point of it is the COLLAPSED state: a section
   *  you cannot see should still tell you how much is in it. */
  count?: number
  /** Open height in px, past which the section scrolls itself. Omit for
   *  sections short enough to never need one. */
  maxHeight?: number
  /** Header controls — "Add Character" and the like. A sibling of the toggle,
   *  never a child of it: nesting a button inside a button is invalid, and
   *  clicking Add would also collapse the thing you are adding to. */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const [collapsed, toggle] = useCollapsed(id)

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${title}` : `Hide ${title}`}
          className="group/sectiontoggle flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-ink transition hover:text-accent"
        >
          <LuChevronDown
            size={14}
            className={`text-ink-faint transition-transform group-hover/sectiontoggle:text-accent ${
              collapsed ? '-rotate-90' : ''
            }`}
          />
          {title}
          {count != null && count > 0 && (
            <span className="text-xs font-medium tabular-nums text-ink-faint normal-case tracking-normal">
              ({count})
            </span>
          )}
        </button>
        {/* Stays reachable while collapsed. Adding to a section you have
            collapsed is a perfectly ordinary thing to want. */}
        {action}
      </div>

      {!collapsed && (
        <div
          // overscroll-contain, or reaching the bottom of the section carries
          // the wheel into the page behind it. The dock hit exactly this with
          // its nested scrollers (SidePanel.tsx) — a scroller inside a
          // scrolling page needs it every time.
          className={maxHeight ? 'overflow-y-auto overscroll-contain' : undefined}
          style={maxHeight ? { maxHeight } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  )
}
