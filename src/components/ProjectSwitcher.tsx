'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LuChevronDown, LuPlus } from 'react-icons/lu'
import NewProjectModal from '@/components/NewProjectModal'

/**
 * Project switcher (KAN-18) — replaces Loom's breadcrumb chain.
 *
 * The breadcrumb did two jobs: showing location, and navigating up. The
 * sidebar's OutlineTree already covers book and chapter better than a trail
 * does, so the only thing left was reaching the series page. This takes that
 * over, and the header drops to one row.
 *
 * Two click targets, deliberately — navigating and switching context are
 * different actions and shouldn't share a hit area:
 *   - the name  -> that project's landing page
 *   - the chevron -> the dropdown
 *
 * "Project" here is a Series row. A standalone book is a Series with
 * standalone:true and exactly one Book — an existing, explicit part of the
 * data model, not a convention invented for this component. It decides both
 * the noun shown and where the name links.
 */

export type SwitcherProject = {
  id: string
  title: string
  standalone: boolean
  /** The single book's id, for standalone projects. Null for a series. */
  firstBookId: string | null
}

/** Where a project's name should take you. */
export function projectHref(p: Pick<SwitcherProject, 'id' | 'standalone' | 'firstBookId'>): string {
  // A standalone author has no series outline worth seeing — POST /api/series
  // already routes creation past it, and this matches.
  return p.standalone && p.firstBookId
    ? `/author/${p.id}/book/${p.firstBookId}`
    : `/author/${p.id}`
}

type Props = {
  /** The project whose name is shown. */
  active: SwitcherProject
}

export default function ProjectSwitcher({ active }: Props) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<SwitcherProject[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Fetched on first open rather than on mount: the list is only needed when
  // the writer actually reaches for it, and this renders on every author page.
  useEffect(() => {
    if (!open || projects) return
    let cancelled = false
    fetch('/api/series')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: SwitcherProject[]) => { if (!cancelled) setProjects(rows) })
      .catch(() => { if (!cancelled) setProjects([]) })
    return () => { cancelled = true }
  }, [open, projects])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const noun = active.standalone ? 'book' : 'series'

  return (
    <>
      <div ref={rootRef} className="relative flex items-center shrink-0">
        {/* The project name takes the LOOM wordmark's slot and size, but not
            its weight or colour: ink at medium rather than accent at bold. The
            wordmark was styled to read as a logo; this is a title, and it
            shouldn't shout the way a brand does. text-ink rather than a literal
            white so it tracks the palette (KAN-6) — under UNIFIED_CHROME that
            resolves to #e8eaf0.

            Truncated because a long title would otherwise push the right-hand
            cluster off. */}
        <Link
          href={projectHref(active)}
          title={`${active.title} — open ${noun}`}
          className="text-ink font-normal tracking-wider text-xl leading-none self-center truncate max-w-[420px] hover:opacity-80 transition"
        >
          {active.title}
        </Link>
        <button
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Switch project"
          title="Switch project"
          className="ml-1 p-1 rounded text-ink-faint hover:text-accent hover:bg-accent/10 transition self-center"
        >
          <LuChevronDown size={16} />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 w-72 z-50 bg-surface-raised border border-accent/20 rounded-xl shadow-2xl overflow-hidden">
            <div className="max-h-80 overflow-y-auto py-1">
              {projects === null ? (
                <div className="px-3 py-2 flex flex-col gap-2 animate-pulse">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-4 bg-surface-muted rounded" style={{ width: `${80 - i * 15}%` }} />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <p className="px-3 py-3 text-xs text-ink-muted">No projects yet.</p>
              ) : (
                projects.map(p => (
                  <Link
                    key={p.id}
                    href={projectHref(p)}
                    onClick={() => setOpen(false)}
                    className={`flex items-baseline justify-between gap-3 px-3 py-2 text-sm transition hover:bg-accent/10 ${
                      p.id === active.id ? 'text-accent font-medium' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{p.title}</span>
                    <span className="text-[10px] uppercase tracking-widest text-ink-faint shrink-0">
                      {p.standalone ? 'Book' : 'Series'}
                    </span>
                  </Link>
                ))
              )}
            </div>

            <button
              onClick={() => { setOpen(false); setShowNew(true) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-accent/10 border-t border-accent/10 transition"
            >
              <LuPlus size={13} /> New project…
            </button>
          </div>
        )}
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </>
  )
}
