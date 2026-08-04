'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { LuChevronDown } from 'react-icons/lu'

// A book-page section that collapses (LOOM-93).
//
// The page stacks full-height sections, so a book with a large cast pushed the
// soundtrack — and anything below it — off the first screen entirely.
//
// Collapsing alone fixes that, and an open section keeps its full height: a
// height cap was tried and cut. Two scrollbars on one page is worse than a long
// page, and a capped section makes you scroll inside a thing you are already
// scrolling past. Collapsing is the same control with none of that — when you
// want the soundtrack, you fold the cast away rather than squinting through a
// window at it.
//
// One component rather than three copies, so the sections cannot drift apart
// the moment one of them grows a header control.

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

      {/* Unmounted rather than hidden. These sections carry <img> and <audio>
          elements, and a collapsed section should not still be fetching
          portraits and album art for something nobody is looking at. */}
      {!collapsed && children}
    </div>
  )
}
