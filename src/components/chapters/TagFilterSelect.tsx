'use client'

import { useRef, useState } from 'react'
import { LuCheck, LuChevronDown, LuSearch, LuX } from 'react-icons/lu'
import { AnchoredPopover, LIST_MAX_HEIGHT, useClickOutside } from '@/components/editor/AnchoredPopover'

// The Chapters tab's filter field (LOOM-120/121).
//
// Built on the same primitives as EventModal's CharacterPicker — same popover,
// same search row, same list geometry — so the two teach one piece of muscle
// memory rather than two. A wall of chips was the first attempt and does not
// survive contact with a 63-character cast.
//
// One deliberate divergence from that picker: this is SINGLE-select, so
// choosing closes the popover and clears the query. CharacterPicker stays open
// because it is building a cast of several; here the choice is complete the
// moment it is made, and leaving the list up would mean a second click to
// dismiss something already finished.

export type FilterOption = { id: string; name: string }

export default function TagFilterSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  emptyHint,
}: {
  /** Sits above the control, so the two filters are distinguishable when both
   *  read "None". */
  label: string
  placeholder: string
  options: FilterOption[]
  value: string | null
  onChange: (id: string | null) => void
  /** Shown in place of the list when nothing is taggable — "no events tagged
   *  in this book yet" is a different state from "your search matched none". */
  emptyHint: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useClickOutside([anchorRef, popRef], () => setOpen(false), open)

  const matches = options.filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = value ? options.find(o => o.id === value) ?? null : null

  function choose(id: string) {
    onChange(id === value ? null : id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>

      <div className="relative flex items-center">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => { setQuery(''); setOpen(v => !v) }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={`flex w-52 items-center justify-between gap-2 rounded-lg border bg-surface-overlay/40 py-2 text-sm transition focus:outline-none ${
            selected ? 'border-accent/40 text-ink' : 'border-accent/20 text-ink-faint'
          } hover:border-accent/50 pl-3 ${selected ? 'pr-8' : 'pr-3'}`}
        >
          <span className="truncate">{selected?.name ?? placeholder}</span>
          <LuChevronDown size={13} className="shrink-0 text-ink-faint" />
        </button>

        {/* Clearing is a separate control from opening the list: "show me
            everything again" is one click, not open-then-find-and-untoggle. */}
        {selected && (
          <button
            type="button"
            onClick={() => { onChange(null); setQuery('') }}
            title={`Clear ${label.toLowerCase()} filter`}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            className="absolute right-7 rounded p-0.5 text-ink-faint transition hover:text-accent"
          >
            <LuX size={12} />
          </button>
        )}
      </div>

      {open && (
        <AnchoredPopover anchorRef={anchorRef} popoverRef={popRef} width={224}>
          <div className="p-2">
            <div className="relative">
              <LuSearch
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={inputRef}
                // autoFocus, not a useEffect: the popover renders null on its
                // first pass while it measures the anchor, so an effect keyed
                // on `open` fires before this input exists.
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  // Enter takes the first match — the same keyboard contract
                  // CharacterPicker has, so typing a few letters and pressing
                  // Enter works in both places.
                  if (e.key === 'Enter' && matches.length > 0) {
                    e.preventDefault()
                    choose(matches[0].id)
                  }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
                }}
                placeholder="Search…"
                aria-label={`Search ${label.toLowerCase()}`}
                className="w-full rounded border border-accent/20 bg-surface-overlay/40 py-1 pl-6 pr-2 text-[11px] text-ink outline-none transition focus:border-accent placeholder:text-ink-faint"
              />
            </div>
          </div>
          <div className="overflow-y-auto pb-1" style={{ maxHeight: LIST_MAX_HEIGHT }} role="listbox">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-ink-faint">
                {options.length === 0 ? emptyHint : 'No matches'}
              </p>
            ) : (
              matches.map(o => {
                const isSelected = o.id === value
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(o.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] transition hover:bg-accent/10 ${
                      isSelected ? 'text-accent' : 'text-ink-muted'
                    }`}
                  >
                    <span className="truncate">{o.name}</span>
                    {isSelected && <LuCheck size={12} className="shrink-0 text-accent" />}
                  </button>
                )
              })
            )}
          </div>
        </AnchoredPopover>
      )}
    </div>
  )
}
