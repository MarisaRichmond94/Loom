'use client'

import { useEffect, useRef, useState } from 'react'
import { LuChevronDown, LuCheck, LuGitBranch } from 'react-icons/lu'

import type { ExploreBook, ExploreMode, ExplorePov } from './types'

// Books, POVs, and the what-if toggle (LOOM-114).
//
// Ported from WriteAI's FilterBar, with one deliberate difference: books the
// page does not allow are shown DISABLED with a reason rather than omitted.
// A silently shorter list reads like a bug — the writer knows how many books
// she has written.
//
// The rule itself is enforced server-side (`clampBookSelection`). This bar is
// how it is explained, not how it is applied.

function Dropdown({
  label, open, onToggle, onClose, active, children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  active?: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
          active
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-accent/20 bg-surface-raised text-ink-muted hover:border-accent/50 hover:text-ink'
        }`}
      >
        <span>{label}</span>
        <LuChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-accent/20 bg-surface-raised shadow-lg">
          {children}
        </div>
      )}
    </div>
  )
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-accent bg-accent text-white' : 'border-accent/30'
      }`}
    >
      {checked && <LuCheck size={9} />}
    </span>
  )
}

export default function ExploreFilterBar({
  books, povs, selectedBooks, selectedPovs, mode,
  onBooks, onPovs, onMode, laterBooks,
}: {
  books: ExploreBook[]
  povs: ExplorePov[]
  /** Empty = all allowed books. */
  selectedBooks: Set<string>
  selectedPovs: Set<string>
  mode: ExploreMode
  onBooks: (next: Set<string>) => void
  onPovs: (next: Set<string>) => void
  onMode: (next: ExploreMode) => void
  /** Books after this one — listed but unselectable, with the reason. */
  laterBooks: { id: string; title: string }[]
}) {
  const [open, setOpen] = useState<'books' | 'povs' | null>(null)
  const close = () => setOpen(null)

  const allBooks = selectedBooks.size === 0
  const allPovs = selectedPovs.size === 0
  const addressable = books.filter(b => b.writeaiNumber !== null)

  const toggleBook = (id: string) => {
    const next = new Set(allBooks ? addressable.map(b => b.id) : selectedBooks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // All selected is the same state as none selected — keep the canonical one
    // so the label reads "All books" rather than "5 books".
    onBooks(next.size === 0 || next.size === addressable.length ? new Set() : next)
  }

  const togglePov = (name: string) => {
    const next = new Set(allPovs ? povs.map(p => p.name) : selectedPovs)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onPovs(next.size === 0 || next.size === povs.length ? new Set() : next)
  }

  const bookLabel = allBooks
    ? addressable.length === 1 ? addressable[0].title : 'All books'
    : selectedBooks.size === 1
      ? books.find(b => selectedBooks.has(b.id))?.title ?? '1 book'
      : `${selectedBooks.size} books`

  const povLabel = allPovs
    ? 'All POVs'
    : selectedPovs.size === 1 ? [...selectedPovs][0] : `${selectedPovs.size} POVs`

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-accent/10 px-4 py-2.5">
      <Dropdown
        label={bookLabel}
        open={open === 'books'}
        onToggle={() => setOpen(o => (o === 'books' ? null : 'books'))}
        onClose={close}
        active={!allBooks}
      >
        <div className="max-h-64 overflow-y-auto py-1">
          {books.map(b => {
            const unindexed = b.writeaiNumber === null
            const checked = !unindexed && (allBooks || selectedBooks.has(b.id))
            return (
              <button
                key={b.id}
                type="button"
                disabled={unindexed}
                onClick={() => toggleBook(b.id)}
                title={unindexed ? 'WriteAI has not analysed this book yet' : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  unindexed
                    ? 'cursor-not-allowed text-ink-faint'
                    : 'hover:bg-surface-overlay'
                }`}
              >
                <Box checked={checked} />
                <span className={checked ? 'text-ink' : 'text-ink-muted'}>{b.title}</span>
                {unindexed && <span className="ml-auto text-[10px] text-ink-faint">not analysed</span>}
              </button>
            )
          })}

          {/* Later books are SHOWN, disabled, with the reason. Omitting them
              would make the list silently shorter than the writer's shelf,
              which reads as a bug rather than as a rule. */}
          {laterBooks.map(b => (
            <div
              key={b.id}
              className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-faint"
            >
              <Box checked={false} />
              <span className="line-through decoration-ink-faint/40">{b.title}</span>
            </div>
          ))}
          {laterBooks.length > 0 && (
            <p className="mt-1 border-t border-accent/10 px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
              Later books are out of reach here — a book page can only draw on
              what a reader has already read. Ask from the series page instead.
            </p>
          )}
        </div>
        {!allBooks && (
          <div className="border-t border-accent/10 px-3 py-1.5">
            <button type="button" onClick={() => onBooks(new Set())}
              className="text-[10px] text-ink-faint hover:text-accent">
              Select all
            </button>
          </div>
        )}
      </Dropdown>

      <Dropdown
        label={povLabel}
        open={open === 'povs'}
        onToggle={() => setOpen(o => (o === 'povs' ? null : 'povs'))}
        onClose={close}
        active={!allPovs}
      >
        <div className="max-h-64 overflow-y-auto py-1">
          {povs.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-faint">No POVs in the selected books</p>
          ) : povs.map(p => {
            const checked = allPovs || selectedPovs.has(p.name)
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => togglePov(p.name)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-overlay"
              >
                <Box checked={checked} />
                <span className={checked ? 'text-ink' : 'text-ink-muted'}>{p.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-ink-faint">{p.chapterCount}</span>
              </button>
            )
          })}
        </div>
        {!allPovs && (
          <div className="border-t border-accent/10 px-3 py-1.5">
            <button type="button" onClick={() => onPovs(new Set())}
              className="text-[10px] text-ink-faint hover:text-accent">
              Select all
            </button>
          </div>
        )}
      </Dropdown>

      {/* What-if: swaps WriteAI's system prompt for a speculation-friendly one.
          Answers in this mode are marked in the message list — a what-if answer
          that reads like canon is the one genuinely dangerous thing this tab
          can produce. */}
      <button
        type="button"
        role="switch"
        aria-checked={mode === 'alternate'}
        onClick={() => onMode(mode === 'alternate' ? 'general' : 'alternate')}
        title="What-if: explore hypotheticals, grounded in canon but free to speculate"
        className={`ml-auto flex items-center gap-1.5 text-xs font-medium transition-colors ${
          mode === 'alternate' ? 'text-accent' : 'text-ink-muted hover:text-ink'
        }`}
      >
        <LuGitBranch size={12} />
        <span>What-if</span>
        <span className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
          mode === 'alternate' ? 'bg-accent' : 'bg-surface-overlay'
        }`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            mode === 'alternate' ? 'left-4' : 'left-0.5'
          }`} />
        </span>
      </button>
    </div>
  )
}
