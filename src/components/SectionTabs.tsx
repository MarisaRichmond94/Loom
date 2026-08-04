'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

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
      <SectionActionSlot.Provider value={actionSlot}>{active?.content}</SectionActionSlot.Provider>
    </div>
  )
}
