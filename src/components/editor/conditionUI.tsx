'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LuX } from 'react-icons/lu'
import { useAuthor } from '@/lib/authorContext'
import type { ConditionCmp } from '@/lib/storyEngine'

export type ConditionVariable = { id: string; name: string; type: string; defaultValue?: string }

export const TYPE_DEFAULT_VALUE: Record<string, unknown> = { string: '', number: 0, boolean: false }

// Resolve the "canon-first" starting value when attaching a variable to a
// condition: the variable's own defaultValue (parsed from its JSON-string
// column) when it's the right type, falling back to the type's zero value.
// Writers tend to write the canon branch first, so this matches the
// boolean-flip default on the next override below.
export function resolveAttachDefault(v: ConditionVariable): unknown {
  if (v.defaultValue) {
    try {
      const parsed = JSON.parse(v.defaultValue)
      if (
        (v.type === 'boolean' && typeof parsed === 'boolean') ||
        (v.type === 'number' && typeof parsed === 'number') ||
        (v.type === 'string' && typeof parsed === 'string')
      ) return parsed
    } catch { /* fall through to zero value */ }
  }
  return TYPE_DEFAULT_VALUE[v.type] ?? ''
}

const baseCls = 'bg-black/20 border border-black/20 rounded pl-2 py-1 text-xs text-ink outline-none focus:border-accent/50 w-full'

export function ValueSetter({ v, currentVal, onChange, autoFocus, suggestions }: {
  v: ConditionVariable
  currentVal: unknown
  onChange: (val: unknown) => void
  autoFocus?: boolean
  // Distinct values written to this variable across the series. When
  // provided for a string-type field, drives a native <datalist> so
  // typing offers the matching prior values — handy for matching
  // exactly what a choice elsewhere set the variable to.
  suggestions?: string[]
}) {
  if (v.type === 'boolean') {
    return (
      <div className="relative w-full">
        <select
          autoFocus={autoFocus}
          value={currentVal !== undefined ? String(currentVal) : ''}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
          className={`${baseCls} appearance-none pr-6`}
        >
          <option value="">— unset —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-xs">▾</span>
      </div>
    )
  }
  // datalist only meaningful for strings (numbers get a numeric input,
  // booleans get a select handled above). Listing duplicates is fine —
  // upstream dedupes — but the id has to be unique enough that two rows
  // pointing at the same variable don't share a list with stale data.
  const listId = v.type === 'string' && suggestions && suggestions.length > 0
    ? `cond-suggest-${v.id || v.name}`
    : undefined
  return (
    <>
      <input
        autoFocus={autoFocus}
        type={v.type === 'number' ? 'number' : 'text'}
        value={currentVal !== undefined ? String(currentVal) : ''}
        list={listId}
        onChange={e => {
          const val = e.target.value
          if (val === '') onChange(undefined)
          else if (v.type === 'number') { if (!isNaN(Number(val))) onChange(Number(val)) }
          else onChange(val)
        }}
        className={`${baseCls} pr-2`}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  )
}

export type ConditionOp = 'and' | 'or'
export type ConditionPolarity = 'show' | 'hide'
// `cmp` is absent for equality clauses (the vast majority, and everything
// legacy). It is only carried for number variables that gate on a range.
export type ConditionClause = { var: string; value: unknown; cmp?: ConditionCmp }

// Comparison operators offered on number-type clauses. Symbols use ≥/≤ for
// the compound operators but store the ASCII '>=' / '<=' the engine reads.
export const CMP_OPTIONS: Array<{ value: ConditionCmp; label: string; title: string }> = [
  { value: '=', label: '=', title: 'equals' },
  { value: '>', label: '>', title: 'greater than' },
  { value: '<', label: '<', title: 'less than' },
  { value: '>=', label: '≥', title: 'at least' },
  { value: '<=', label: '≤', title: 'at most' },
]

function CmpSelect({ value, onChange }: { value: ConditionCmp; onChange: (cmp: ConditionCmp) => void }) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value as ConditionCmp)}
        title="Comparison"
        className="appearance-none bg-black/20 border border-black/20 rounded text-xs text-ink-muted outline-none focus:border-accent/50 pl-1.5 pr-4 py-0.5 cursor-pointer"
      >
        {CMP_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-[9px]">▾</span>
    </div>
  )
}

type ParsedCondition = { op: ConditionOp; polarity: ConditionPolarity; clauses: ConditionClause[] }

// Reads either legacy (`{ a: 1, b: 2 }`) or compound (`{ op, clauses, mode? }`)
// JSON shapes and normalizes to a single in-memory form for the editor. The
// optional `mode: 'hide'` marker on the compound shape flips the polarity:
// when present, the condition reads as "hide if matched" rather than the
// default "show if matched". Legacy shape has no place to store polarity,
// so it always parses as 'show'.
export function parseCondition(raw: string | null): ParsedCondition {
  if (!raw) return { op: 'and', polarity: 'show', clauses: [] }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      if ('op' in parsed && Array.isArray((parsed as { clauses?: unknown }).clauses)) {
        const compound = parsed as { op: unknown; mode?: unknown; clauses: ConditionClause[] }
        return {
          op: compound.op === 'or' ? 'or' : 'and',
          polarity: compound.mode === 'hide' ? 'hide' : 'show',
          clauses: compound.clauses,
        }
      }
      return {
        op: 'and',
        polarity: 'show',
        clauses: Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({ var: k, value: v })),
      }
    }
  } catch { /* fall through */ }
  return { op: 'and', polarity: 'show', clauses: [] }
}

// Writes back to legacy shape when op=AND, polarity=show, or single clause —
// keeps existing on-disk data readable. Falls to the compound shape when we
// need somewhere to store op=OR or mode=hide. An empty clause list never
// emits anything, regardless of polarity (no "hide always" — degenerate).
export function stringifyCondition(op: ConditionOp, clauses: ConditionClause[], polarity: ConditionPolarity = 'show'): string | null {
  if (clauses.length === 0) return null
  // Any non-equality clause forces the compound shape — the legacy
  // `{ var: value }` object has nowhere to put an operator.
  const hasCmp = clauses.some(c => c.cmp && c.cmp !== '=')
  if (!hasCmp && polarity === 'show' && (op === 'and' || clauses.length === 1)) {
    const obj: Record<string, unknown> = {}
    for (const c of clauses) obj[c.var] = c.value
    return JSON.stringify(obj)
  }
  // Emit `cmp` only for real comparisons so equality clauses stay compact and
  // an absent operator keeps meaning '=' on disk.
  const compound: { op: ConditionOp; clauses: ConditionClause[]; mode?: 'hide' } = {
    op,
    clauses: clauses.map(c => (c.cmp && c.cmp !== '=' ? { var: c.var, value: c.value, cmp: c.cmp } : { var: c.var, value: c.value })),
  }
  if (polarity === 'hide') compound.mode = 'hide'
  return JSON.stringify(compound)
}

function OpToggle({ value, onChange, disabled }: {
  value: ConditionOp
  onChange?: (next: ConditionOp) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex rounded overflow-hidden border border-accent/20 text-xs shrink-0 ${disabled ? 'opacity-40' : ''}`}>
      {(['and', 'or'] as const).map(o => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => onChange?.(o)}
          title={o === 'and' ? 'All listed variables must match' : 'At least one listed variable must match'}
          className={`px-2 py-0.5 transition uppercase tracking-wider ${value === o ? 'bg-accent text-surface-base' : 'text-ink-faint'} ${!disabled && value !== o ? 'hover:text-ink' : ''} ${disabled ? 'cursor-default' : ''}`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function ConditionRow({ condition, variables, onChange, label = 'Show if:', labelExtra, polarityToggle = false }: {
  condition: string | null
  variables: ConditionVariable[]
  onChange: (next: string | null) => void
  label?: string
  labelExtra?: ReactNode
  // When true, the row's leading label becomes a SHOW IF / HIDE IF toggle
  // and the polarity is stored in the condition JSON. Off by default — only
  // chapter settings opts in; block override conditions stay show-only.
  polarityToggle?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Reset the filter every time the menu reopens and autofocus the input so
  // the writer can start typing immediately — same pattern as the genre
  // filter dropdown on Explore.
  useEffect(() => {
    if (menuOpen) {
      setMenuQuery('')
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [menuOpen])

  // Suggestions for the string value input come from the author layout
  // (loaded once, refreshed when choices change). ConditionRow itself
  // is currently only rendered under the author layout, so useAuthor
  // is safe.
  const { knownStringValues } = useAuthor()

  const { op, polarity, clauses } = parseCondition(condition)
  const valueByName: Record<string, unknown> = {}
  const cmpByName: Record<string, ConditionCmp> = {}
  for (const c of clauses) {
    valueByName[c.var] = c.value
    cmpByName[c.var] = c.cmp ?? '='
  }
  const attachedNames = new Set(clauses.map(c => c.var))
  const attachedVars = variables.filter(v => attachedNames.has(v.name))
  const unattachedVars = variables.filter(v => !attachedNames.has(v.name))

  function save(nextOp: ConditionOp, nextClauses: ConditionClause[], nextPolarity: ConditionPolarity = polarity) {
    onChange(stringifyCondition(nextOp, nextClauses.filter(c => c.value !== undefined), nextPolarity))
  }

  function setVal(name: string, val: unknown) {
    if (val === undefined) {
      save(op, clauses.filter(c => c.var !== name))
      return
    }
    // Spread preserves cmp — editing the value must not silently reset a
    // comparison operator back to equality.
    const updated = clauses.map(c => c.var === name ? { ...c, value: val } : c)
    save(op, updated)
  }

  function setCmp(name: string, cmp: ConditionCmp) {
    const updated = clauses.map(c => c.var === name ? { ...c, cmp } : c)
    save(op, updated)
  }

  function detach(name: string) {
    save(op, clauses.filter(c => c.var !== name))
  }

  function attach(v: ConditionVariable) {
    save(op, [...clauses, { var: v.name, value: resolveAttachDefault(v) }])
    setMenuOpen(false)
  }

  function setOp(nextOp: ConditionOp) {
    save(nextOp, clauses)
  }

  function setPolarity(nextPolarity: ConditionPolarity) {
    save(op, clauses, nextPolarity)
  }

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      {polarityToggle ? (
        <div className="flex rounded overflow-hidden border border-accent/20 text-xs shrink-0">
          {(['show', 'hide'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPolarity(p)}
              title={p === 'show' ? 'Render to the reader only when these variables match' : 'Hide from the reader when these variables match'}
              className={`px-2 py-0.5 transition uppercase tracking-wider ${polarity === p ? 'bg-accent text-surface-base' : 'text-ink-faint hover:text-ink'}`}
            >
              {p} if
            </button>
          ))}
        </div>
      ) : (
        <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">{label}</span>
      )}
      {labelExtra}
      {clauses.length === 0 && (
        <span className="text-xs text-ink-faint italic">always</span>
      )}
      {attachedVars.map((v, i) => (
        <div key={v.id} className="flex items-center gap-2">
          {i > 0 && (
            <OpToggle
              value={op}
              // Only the first operator (between clauses 1 and 2) is interactive —
              // all clauses share one op, the rest are display-only reminders.
              onChange={i === 1 ? setOp : undefined}
              disabled={i > 1}
            />
          )}
          <div className="flex items-center gap-1 bg-black/20 border border-black/20 rounded px-2 py-0.5">
            <span className="text-xs text-ink-muted">{v.name}</span>
            {v.type === 'number' ? (
              <CmpSelect value={cmpByName[v.name] ?? '='} onChange={cmp => setCmp(v.name, cmp)} />
            ) : (
              <span className="text-xs text-ink-faint">=</span>
            )}
            <div className="w-24">
              <ValueSetter v={v} currentVal={valueByName[v.name]} onChange={val => setVal(v.name, val)} suggestions={knownStringValues[v.name]} />
            </div>
            <button onClick={() => detach(v.name)} className="text-ink-muted hover:text-choice-kill transition shrink-0">
              <LuX size={11} />
            </button>
          </div>
        </div>
      ))}
      {unattachedVars.length > 0 && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="text-ink-muted hover:text-ink transition text-sm leading-none px-1"
          >
            +
          </button>
          {menuOpen && (() => {
            const q = menuQuery.trim().toLowerCase()
            const filtered = q ? unattachedVars.filter(v => v.name.toLowerCase().includes(q)) : unattachedVars
            return (
              <div className="absolute left-0 bottom-full mb-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[220px]">
                <div className="px-2 py-1.5 border-b border-accent/10">
                  <input
                    ref={searchInputRef}
                    value={menuQuery}
                    onChange={e => setMenuQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && filtered.length > 0) {
                        e.preventDefault()
                        attach(filtered[0])
                      }
                    }}
                    placeholder="Search variables…"
                    className="w-full bg-black/20 border border-black/20 rounded px-2 py-1 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
                  />
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: '126px' }}>
                  {filtered.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-ink-faint italic">No matches</p>
                  ) : filtered.map(v => (
                    <button
                      key={v.id}
                      onClick={() => attach(v)}
                      className="flex items-center justify-between w-full px-4 py-2 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left gap-4"
                    >
                      <span>{v.name}</span>
                      <span className="text-ink-faint text-xs">{v.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
