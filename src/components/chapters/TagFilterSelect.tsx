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
// Single-select by default: choosing closes the popover and clears the query,
// because the choice is complete the moment it is made and leaving the list up
// would mean a second click to dismiss something already finished.
//
// `multiple` opts into CharacterPicker's behaviour instead — clicking toggles
// and the popover STAYS open, because you are building a set and closing after
// each name would mean reopening for the next. Enter additionally empties the
// search box while holding focus, so a set can be built as
// type-Enter-type-Enter.

export type FilterOption = { id: string; name: string }

/**
 * "Clear filters" — resets every field at once, sitting to the right of them.
 *
 * Always rendered, disabled when nothing is set, rather than appearing only
 * while filtering: a control that pops into existence shifts whatever sits
 * beside it, and the skeleton above the board would have to guess whether to
 * draw it. Disabled it is always in the same place, and the skeleton can
 * always draw it.
 *
 * A ghost control — text only, no border, no fill, no icon. The fields beside
 * it are the boxes; giving the reset the same weight would read as a fourth
 * one. Padding, not a height class: it is a sibling of those fields in an
 * `items-end` row, so matching their py/text keeps the bottoms in line however
 * the type scale moves.
 */
export function ClearFiltersButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Clear all filters"
      className="px-1 py-2 text-sm text-ink-faint transition enabled:hover:text-accent disabled:opacity-40"
    >
      Clear
    </button>
  )
}

type Base = {
  /** Sits above the control, so the filters are distinguishable when they all
   *  read the same placeholder. */
  label: string
  placeholder: string
  options: FilterOption[]
  /** Shown in place of the list when nothing is taggable — "no events tagged
   *  in this book yet" is a different state from "your search matched none". */
  emptyHint: string
}

// A discriminated union rather than one `string[]` shape for both: a
// single-select caller holding a one-element array would have to unwrap it at
// every use, and nothing would stop it holding two.
type Props = Base & (
  | { multiple?: false; value: string | null; onChange: (id: string | null) => void }
  | { multiple: true; value: string[]; onChange: (ids: string[]) => void }
)

export default function TagFilterSelect(props: Props) {
  const { label, placeholder, options, emptyHint } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // The whole field is the anchor now, not the trigger button — so the popover
  // lines up with the control's full width rather than with one control inside it.
  const anchorRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useClickOutside([anchorRef, popRef], () => setOpen(false), open)

  const matches = options.filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()))
  const selectedIds = props.multiple ? props.value : props.value ? [props.value] : []
  const selectedSet = new Set(selectedIds)
  // Named from `options`, not from the ids: an id whose option has gone away
  // (a character untagged out of the book while the filter was set) should
  // drop out of the summary rather than render as a raw cuid.
  const selectedNames = selectedIds
    .map(id => options.find(o => o.id === id)?.name)
    .filter((n): n is string => !!n)
  // "Kira +2" rather than "3 selected": the first name is the one she is most
  // likely to be checking, and the count carries the rest.
  const display =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames[0]} +${selectedNames.length - 1}`

  function choose(id: string, viaEnter = false) {
    if (props.multiple) {
      props.onChange(
        props.value.includes(id) ? props.value.filter(v => v !== id) : [...props.value, id],
      )
      // Enter is the "type a name, commit it, type the next" gesture, so it
      // clears the query — otherwise the second name means reaching for
      // backspace first. A CLICK keeps the query: a search like "gat" may have
      // several names under it, and clearing would make picking the second one
      // a retype.
      if (viaEnter) setQuery('')
      // Focus comes back to the search box either way, so typing continues to
      // go where she is looking. After a click it sits on the option button,
      // where the next keystroke would do nothing.
      inputRef.current?.focus()
      return
    }
    props.onChange(id === props.value ? null : id)
    setQuery('')
    setOpen(false)
  }

  function clear() {
    if (props.multiple) props.onChange([])
    else props.onChange(null)
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>

      {/* The three controls are flex SIBLINGS, not an absolutely-positioned
          clear button laid over the trigger. Overlaying put the ✕ on top of
          the caret, because the caret sits inside the trigger's own padding
          and the two were positioned from the same edge independently. Laid
          out in a row, they cannot collide however the label is sized. */}
      <div
        ref={anchorRef}
        className={`flex w-52 items-center gap-1 rounded-lg border bg-surface-overlay/40 py-2 pl-3 pr-2 text-sm transition ${
          selectedNames.length > 0 ? 'border-accent/40 text-ink' : 'border-accent/20 text-ink-faint'
        } hover:border-accent/50`}
      >
        <button
          type="button"
          onClick={() => { setQuery(''); setOpen(v => !v) }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="min-w-0 flex-1 truncate text-left focus:outline-none"
        >
          {display}
        </button>

        {/* Clearing is its own control: "show me everything again" is one
            click, not open-then-find-and-untoggle. */}
        {selectedNames.length > 0 && (
          <button
            type="button"
            onClick={clear}
            title={`Clear ${label.toLowerCase()} filter`}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-accent"
          >
            <LuX size={12} />
          </button>
        )}

        <button
          type="button"
          onClick={() => { setQuery(''); setOpen(v => !v) }}
          aria-label={`Open ${label.toLowerCase()} list`}
          tabIndex={-1}
          className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-accent"
        >
          <LuChevronDown size={13} />
        </button>
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
                  // Enter works in both places. In `multiple` mode it also
                  // clears the box and keeps focus, so several names can be
                  // added as type-Enter-type-Enter without touching the mouse.
                  if (e.key === 'Enter' && matches.length > 0) {
                    e.preventDefault()
                    choose(matches[0].id, true)
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
                const isSelected = selectedSet.has(o.id)
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
